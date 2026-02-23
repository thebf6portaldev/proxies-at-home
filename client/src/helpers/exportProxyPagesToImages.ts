import JSZip from "jszip";
import { API_BASE } from "@/constants";
import type { CardOption } from "../../../shared/types";
import { AsyncLock } from "./AsyncLock";
import type { WorkerPdfSettings } from "./serializeSettingsForWorker";
import { getEffectCacheEntry } from "./effectCache";
import { hasActiveAdjustments } from "./adjustmentUtils";

/**
 * Worker event types (mirrors the PDF export coordinator pattern)
 */
type WorkerEvent =
  | { type: 'WORKER_READY'; workerId: number }
  | { type: 'PAGE_COMPLETE'; pageIndex: number; url: string }
  | { type: 'PROGRESS'; pageIndex: number; imagesProcessed: number }
  | { type: 'ERROR'; error: Error; pageIndex?: number };

interface WorkerInfo {
  worker: Worker;
  busy: boolean;
}

function* pageGenerator(
  cards: CardOption[],
  perPage: number
): Generator<CardOption[], void, void> {
  for (let i = 0; i < cards.length; i += perPage) {
    yield cards.slice(i, i + perPage);
  }
}

/**
 * Export proxy pages as a ZIP archive of JPEG images.
 * Reuses the same pdf.worker rendering pipeline as PDF export, but collects
 * the resulting page images into a ZIP file instead of assembling a PDF.
 *
 * For duplex export, pass an external `zip` + `pageOffset` (and `skipDownload: true`)
 * so two passes (fronts then backs) share a single ZIP before a final download.
 */
export async function exportProxyPagesToImages({
  cards,
  imagesById,
  pdfSettings,
  onProgress,
  cancellationPromise,
  filenameSuffix = '',
  zip: externalZip,
  pageOffset = 0,
  skipDownload = false,
}: {
  cards: CardOption[];
  imagesById: Map<string, import("../db").Image>;
  pdfSettings: WorkerPdfSettings;
  onProgress?: (progress: number) => void;
  cancellationPromise: Promise<void>;
  filenameSuffix?: string;
  /** Provide an existing JSZip instance to append pages into (used for duplex). */
  zip?: JSZip;
  /** Starting page number offset when appending into an external zip. */
  pageOffset?: number;
  /** When true, skip the download step (caller will trigger it). */
  skipDownload?: boolean;
}): Promise<{ zip: JSZip; totalPages: number } | void> {
  if (!cards || !cards.length) return;

  const {
    bleedEdge,
    bleedEdgeWidthMm,
    sourceSettings,
    withBleedSourceAmount,
    darkenMode,
    dpi,
    pageWidth,
    pageHeight,
    pageSizeUnit,
    columns,
    rows,
    cardSpacingMm,
    cardPositionX,
    cardPositionY,
    guideColor,
    guideWidthCssPx,
    cutLineStyle,
    perCardGuideStyle,
    guidePlacement,
    cutGuideLengthMm,
    registrationMarks,
    registrationMarksPortrait,
    rightAlignRows,
    darkenThreshold,
    darkenContrast,
    darkenEdgeWidth,
    darkenAmount,
    darkenBrightness,
    darkenAutoDetect,
    useCustomBackOffset,
    cardBackPositionX,
    cardBackPositionY,
    perCardBackOffsets,
    gridAlignment,
    gridMarginXMm,
    gridMarginYMm,
  } = pdfSettings;

  const perPage = Math.max(1, columns * rows);
  const totalImages = cards.length;
  let totalImagesProcessed = 0;

  // Build effect cache map for cards with active adjustments
  const effectCacheById = new Map<string, Blob>();
  for (const card of cards) {
    if (card.imageId && card.overrides && hasActiveAdjustments(card.overrides)) {
      const cached = await getEffectCacheEntry(card.imageId, card.overrides);
      if (cached) {
        effectCacheById.set(card.uuid, cached);
      }
    }
  }

  const allPages: CardOption[][] = [];
  for (const page of pageGenerator(cards, perPage)) {
    allPages.push(page);
  }

  const workerPool: Worker[] = [];

  try {
    const collectedBlobs = await Promise.race<Map<number, Blob>>([
      new Promise<Map<number, Blob>>((resolve, reject) => {
        (async () => {
          const baseWorkers = Math.floor(Math.log2(navigator.hardwareConcurrency || 1)) + 1;
          const maxWorkers = baseWorkers;

          const taskQueue = allPages.map((pageCards, index) => ({ pageCards, pageIndex: index }));
          const pageBlobs = new Map<number, Blob>();
          const pageImageProgress = new Array(allPages.length).fill(0);
          const workerInfoPool: WorkerInfo[] = [];

          const coordinator = (() => {
            const lock = new AsyncLock();

            return {
              async handleEvent(event: WorkerEvent) {
                await lock.acquire();
                try {
                  switch (event.type) {
                    case 'PAGE_COMPLETE': {
                      // Fetch the blob URL and store as Blob
                      const response = await fetch(event.url);
                      const blob = await response.blob();
                      URL.revokeObjectURL(event.url);
                      pageBlobs.set(event.pageIndex, blob);

                      if (onProgress) {
                        // Pages complete contribute to the final 10% of progress
                        // (images processed covers the first 90%)
                        const pagesComplete = pageBlobs.size;
                        const pagesTotal = allPages.length;
                        const imagesPct = (totalImagesProcessed / totalImages) * 90;
                        const pagesPct = (pagesComplete / pagesTotal) * 10;
                        onProgress(imagesPct + pagesPct);
                      }

                      await this.tryAssignNextTask();

                      // Check if all pages are done
                      if (pageBlobs.size === allPages.length) {
                        workerInfoPool.forEach(w => w.worker.terminate());
                        resolve(pageBlobs);
                      }
                      break;
                    }

                    case 'PROGRESS': {
                      const oldProgress = pageImageProgress[event.pageIndex];
                      pageImageProgress[event.pageIndex] = event.imagesProcessed;
                      totalImagesProcessed += event.imagesProcessed - oldProgress;
                      if (onProgress) {
                        onProgress((totalImagesProcessed / totalImages) * 90);
                      }
                      break;
                    }

                    case 'WORKER_READY':
                      await this.tryAssignNextTask();
                      break;

                    case 'ERROR':
                      workerInfoPool.forEach(w => w.worker.terminate());
                      reject(event.error);
                      break;
                  }
                } finally {
                  lock.release();
                }
              },

              async tryAssignNextTask() {
                if (taskQueue.length > 0) {
                  const idleWorker = workerInfoPool.find(w => !w.busy);
                  if (idleWorker) {
                    const task = taskQueue.shift()!;
                    idleWorker.busy = true;

                    const pageEffectCache = new Map<string, Blob>();
                    for (const card of task.pageCards) {
                      const cached = effectCacheById.get(card.uuid);
                      if (cached) pageEffectCache.set(card.uuid, cached);
                    }

                    const settings = {
                      pageWidth,
                      pageHeight,
                      pageSizeUnit,
                      columns,
                      rows,
                      bleedEdge,
                      bleedEdgeWidthMm,
                      cardSpacingMm,
                      cardPositionX,
                      cardPositionY,
                      guideColor,
                      guideWidthCssPx,
                      DPI: dpi,
                      imagesById,
                      API_BASE,
                      darkenMode,
                      darkenThreshold,
                      darkenContrast,
                      darkenEdgeWidth,
                      darkenAmount,
                      darkenBrightness,
                      darkenAutoDetect,
                      cutLineStyle,
                      perCardGuideStyle,
                      guidePlacement,
                      cutGuideLengthMm,
                      registrationMarks,
                      registrationMarksPortrait,
                      sourceSettings,
                      withBleedSourceAmount,
                      rightAlignRows,
                      gridAlignment,
                      gridMarginXMm,
                      gridMarginYMm,
                      useCustomBackOffset,
                      cardBackPositionX,
                      cardBackPositionY,
                      perCardBackOffsets,
                      effectCacheById: pageEffectCache,
                    };

                    idleWorker.worker.postMessage({
                      pageCards: task.pageCards,
                      pageIndex: task.pageIndex,
                      settings,
                    });
                  }
                }
              },
            };
          })();

          for (let i = 0; i < maxWorkers; i++) {
            const worker = new Worker(
              new URL("./pdf.worker.ts", import.meta.url),
              { type: "module" }
            );

            const workerInfo: WorkerInfo = { worker, busy: false };
            workerInfoPool.push(workerInfo);
            workerPool.push(worker);

            worker.onmessage = async (event: MessageEvent) => {
              const { type, error, pageIndex, url, imagesProcessed } = event.data;

              if (error) {
                workerInfo.busy = false;
                await coordinator.handleEvent({
                  type: 'ERROR',
                  error: new Error(`Error from worker for page ${pageIndex + 1}: ${error}`),
                  pageIndex,
                });
                return;
              }

              if (type === 'progress') {
                await coordinator.handleEvent({ type: 'PROGRESS', pageIndex, imagesProcessed });
                return;
              }

              if (type === 'result' && url) {
                workerInfo.busy = false;
                await coordinator.handleEvent({ type: 'PAGE_COMPLETE', pageIndex, url });
              }
            };

            worker.onerror = (e) => {
              coordinator.handleEvent({
                type: 'ERROR',
                error: e instanceof Error ? e : new Error('Worker error'),
              });
            };

            await coordinator.handleEvent({ type: 'WORKER_READY', workerId: i });
          }
        })().catch(reject);
      }),
      cancellationPromise.then(() => Promise.reject(new Error("Cancelled by user"))),
    ]);

    // Assemble ZIP in page order
    if (onProgress && !externalZip) onProgress(95);
    const zip = externalZip ?? new JSZip();
    const pageCount = allPages.length;

    // Total pages across all passes (needed for consistent zero-padded filenames)
    // When using an external zip the caller controls total page count via pageOffset
    const totalGlobalPages = pageOffset + pageCount;
    const padLen = String(totalGlobalPages).length;

    for (let i = 0; i < pageCount; i++) {
      const blob = collectedBlobs.get(i);
      if (blob) {
        const globalIndex = pageOffset + i;
        zip.file(`page_${String(globalIndex + 1).padStart(padLen, '0')}.jpg`, blob);
      }
    }

    if (skipDownload) {
      return { zip, totalPages: pageOffset + pageCount };
    }

    if (onProgress) onProgress(98);
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `proxxies_${date}${filenameSuffix}_pages.zip`;

    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (onProgress) onProgress(100);
  } catch (error: unknown) {
    workerPool.forEach(w => w.terminate());
    throw error;
  }
}
