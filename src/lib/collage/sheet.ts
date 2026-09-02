/**
 * Sheets: many pictures arriving as one.
 *
 * An image model will not give you nine separate cut-outs. It gives you one
 * picture with nine things arranged in it, which is the format the whole
 * generate-then-stage loop has to be built around rather than fought.
 *
 * Cutting one up is arithmetic — a grid is a grid — so this is where the
 * arithmetic lives, apart from the canvas and apart from the tools, because the
 * off-by-one that matters here (a cell that includes one row of its
 * neighbour's pixels) is invisible on screen and obvious in a test.
 */

/** A box in image fractions, 0–1 from the top left, as the cutter wants them. */
export interface Cell {
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
}

export interface GridSpec {
    columns: number;
    rows: number;
    /**
     * How much of each cell to shave off the edge, 0–1 of the cell.
     *
     * A generated sheet never lands its subjects on an exact grid: the gutters
     * wander by a few pixels and a cell taken at its mathematical bounds
     * catches a sliver of whichever neighbour drifted. Shaving is the cheaper
     * fix by far — the subject was told to stay well inside its cell, so the
     * margin being thrown away is gutter, while the sliver being kept would
     * become a second object in the cut.
     */
    inset?: number;
    labels?: string[];
}

/** Enough of a shave to swallow a wandering gutter; little enough to keep the art. */
export const DEFAULT_INSET = 0.02;

/**
 * A grid, in reading order — left to right, then down.
 *
 * The same order the prompt asks for the subjects in, which is what lets a
 * caller hand over a list of names and have them land on the right pieces.
 */
export function gridCells(spec: GridSpec): Cell[] {
    const columns = Math.max(1, Math.round(spec.columns));
    const rows = Math.max(1, Math.round(spec.rows));
    const inset = Math.min(0.4, Math.max(0, spec.inset ?? DEFAULT_INSET));

    const cellWidth = 1 / columns;
    const cellHeight = 1 / rows;
    const padX = cellWidth * inset;
    const padY = cellHeight * inset;

    const cells: Cell[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const label = spec.labels?.[row * columns + column];
            cells.push({
                x: column * cellWidth + padX,
                y: row * cellHeight + padY,
                width: cellWidth - padX * 2,
                height: cellHeight - padY * 2,
                ...(label?.trim() ? { label: label.trim() } : {}),
            });
        }
    }
    return cells;
}

/** Where a cell sits in a real image, in pixels, ready to be drawn from. */
export function cellPixels(cell: Cell, width: number, height: number) {
    const x = Math.round(cell.x * width);
    const y = Math.round(cell.y * height);
    return {
        x,
        y,
        // Rounded from the far edge rather than by rounding the width, so
        // adjacent cells cannot both round up and overlap by a pixel.
        width: Math.max(1, Math.round((cell.x + cell.width) * width) - x),
        height: Math.max(1, Math.round((cell.y + cell.height) * height) - y),
    };
}
