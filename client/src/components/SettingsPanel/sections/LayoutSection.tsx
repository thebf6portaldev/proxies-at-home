import { useSettingsStore } from "@/store/settings";
import { Label } from "flowbite-react";
import { PageSizeControl } from "../../LayoutSettings/PageSizeControl";
import { NumberInput } from "@/components/common";
import { useNormalizedInput } from "@/hooks/useInputHooks";

export function LayoutSection() {
    const columns = useSettingsStore((state) => state.columns);
    const rows = useSettingsStore((state) => state.rows);
    const setColumns = useSettingsStore((state) => state.setColumns);
    const setRows = useSettingsStore((state) => state.setRows);
    const gridAlignment = useSettingsStore((state) => state.gridAlignment);
    const setGridAlignment = useSettingsStore((state) => state.setGridAlignment);
    const gridMarginXMm = useSettingsStore((state) => state.gridMarginXMm);
    const setGridMarginXMm = useSettingsStore((state) => state.setGridMarginXMm);
    const gridMarginYMm = useSettingsStore((state) => state.gridMarginYMm);
    const setGridMarginYMm = useSettingsStore((state) => state.setGridMarginYMm);

    const columnsInput = useNormalizedInput(
        columns,
        (value) => setColumns(value),
        { min: 1, max: 10, isInteger: true }
    );

    const rowsInput = useNormalizedInput(
        rows,
        (value) => setRows(value),
        { min: 1, max: 10, isInteger: true }
    );

    const marginXInput = useNormalizedInput(
        gridMarginXMm,
        (value) => setGridMarginXMm(value),
        { min: 0, max: 50, isInteger: false }
    );

    const marginYInput = useNormalizedInput(
        gridMarginYMm,
        (value) => setGridMarginYMm(value),
        { min: 0, max: 50, isInteger: false }
    );

    return (
        <div className="space-y-4">
            <PageSizeControl />

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label htmlFor="columns-input">Columns</Label>
                    <NumberInput
                        id="columns-input"
                        ref={columnsInput.inputRef}
                        className="w-full"
                        min={1}
                        max={10}
                        defaultValue={columnsInput.defaultValue}
                        onChange={columnsInput.handleChange}
                        onBlur={columnsInput.handleBlur}
                        placeholder={columns.toString()}
                    />
                </div>
                <div>
                    <Label htmlFor="rows-input">Rows</Label>
                    <NumberInput
                        id="rows-input"
                        ref={rowsInput.inputRef}
                        className="w-full"
                        min={1}
                        max={10}
                        defaultValue={rowsInput.defaultValue}
                        onChange={rowsInput.handleChange}
                        onBlur={rowsInput.handleBlur}
                        placeholder={rows.toString()}
                    />
                </div>
            </div>

            {/* Grid alignment */}
            <div className="space-y-2">
                <Label>Grid Alignment</Label>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 text-sm">
                    <button
                        type="button"
                        onClick={() => setGridAlignment('center')}
                        className={`flex-1 py-1.5 px-3 transition-colors ${
                            gridAlignment === 'center'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                    >
                        Centered
                    </button>
                    <button
                        type="button"
                        onClick={() => setGridAlignment('top-left')}
                        className={`flex-1 py-1.5 px-3 border-l border-gray-300 dark:border-gray-600 transition-colors ${
                            gridAlignment === 'top-left'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                    >
                        Top-Left
                    </button>
                </div>
                {gridAlignment === 'top-left' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label htmlFor="grid-margin-x-input">
                                X margin <span className="text-gray-400 font-normal">(mm)</span>
                            </Label>
                            <NumberInput
                                id="grid-margin-x-input"
                                ref={marginXInput.inputRef}
                                className="w-full"
                                min={0}
                                max={50}
                                step={0.1}
                                defaultValue={marginXInput.defaultValue}
                                onChange={marginXInput.handleChange}
                                onBlur={marginXInput.handleBlur}
                                placeholder={gridMarginXMm.toString()}
                            />
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {(gridMarginXMm / 25.4).toFixed(3)}&quot;
                            </p>
                        </div>
                        <div>
                            <Label htmlFor="grid-margin-y-input">
                                Y margin <span className="text-gray-400 font-normal">(mm)</span>
                            </Label>
                            <NumberInput
                                id="grid-margin-y-input"
                                ref={marginYInput.inputRef}
                                className="w-full"
                                min={0}
                                max={50}
                                step={0.1}
                                defaultValue={marginYInput.defaultValue}
                                onChange={marginYInput.handleChange}
                                onBlur={marginYInput.handleBlur}
                                placeholder={gridMarginYMm.toString()}
                            />
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {(gridMarginYMm / 25.4).toFixed(3)}&quot;
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
