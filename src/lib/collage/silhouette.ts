/**
 * Packing shapes instead of rectangles.
 *
 * Everything on this canvas has had its background removed, so a layer's box is
 * mostly empty: a cactus is a cross in a square, a hanging plant is a stem with
 * air either side. Packing those boxes reserves all that nothing, which is why
 * a tightly packed page of cut-outs still reads as a grid — every shape ends up
 * with a rectangle of clearance around it that nobody asked for.
 *
 * What a packer actually needs from a shape is thinner than the shape itself:
 * for each vertical slice, where the opaque pixels start and where they stop.
 * Two numbers per column. That is enough to let one shape settle into another's
 * concavity — a small pot rising between a plant's leaves — and it costs a
 * couple of hundred bytes rather than a polygon library.
 *
 * The grid comes from the same alpha mask the canvas already builds for hit
 * testing, so nothing new is decoded. Everything here is arithmetic, with no
 * browser in it, so a profile can be asserted on in a test.
 */
import type { AlphaMask } from "./imaging.js";
import type { CropBox } from "./model.js";

/** A coarse map of where a layer is opaque, over its visible (cropped) box. */
export interface Shape {
    columns: number;
    rows: number;
    /** Row-major, 1 where opaque. */
    cells: Uint8Array;
}

/**
 * The outline of a shape as a packer sees it: where it starts and stops in each
 * vertical slice, as fractions of the box being packed.
 *
 * `filled` marks the columns the shape actually occupies. An empty column is
 * not "a column whose shape has zero height" — it is a column the shape does
 * not constrain at all, and a neighbour may pass straight through it.
 */
export interface Profile {
    columns: number;
    top: Float32Array;
    bottom: Float32Array;
    filled: Uint8Array;
}

/** How finely a shape is sampled. Two hundred cells is plenty for nesting. */
const SHAPE_GRID = 20;

/**
 * Reduce an alpha mask to a shape grid over the layer's cropped box.
 *
 * The crop matters: a layer shows a window onto its mask, and packing has to
 * agree with what is drawn, not with the whole source image.
 */
export function shapeFromMask(mask: AlphaMask, crop: CropBox, size = SHAPE_GRID): Shape {
    const columns = Math.max(1, size);
    const rows = Math.max(1, size);
    const cells = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row++) {
        const v = (row + 0.5) / rows;
        const my = Math.min(mask.height - 1, Math.max(0, Math.floor((crop.y + v * crop.height) * mask.height)));
        for (let column = 0; column < columns; column++) {
            const u = (column + 0.5) / columns;
            const mx = Math.min(mask.width - 1, Math.max(0, Math.floor((crop.x + u * crop.width) * mask.width)));
            cells[row * columns + column] = mask.data[my * mask.width + mx];
        }
    }
    return { columns, rows, cells };
}

/** A shape that fills its box — what a text layer or an undecoded image gets. */
export function solidProfile(columns: number): Profile {
    return {
        columns,
        top: new Float32Array(columns),
        bottom: new Float32Array(columns).fill(1),
        filled: new Uint8Array(columns).fill(1),
    };
}

/**
 * The profile of a shape once tilted, in the coordinates of its swept box.
 *
 * Rotation is applied here rather than baked into the grid because the layout
 * chooses the tilt: the same shape is asked for a different profile depending
 * on which way it ends up leaning.
 *
 * Sampling rather than transforming: for each cell of the swept box, rotate the
 * point back into the shape's own frame and ask whether it is opaque there.
 * Inverse mapping is what stops a rotation leaving holes, which forward mapping
 * does as soon as the source and destination grids disagree.
 */
export function profileOf(
    shape: Shape | null,
    rotation: number,
    aspect: number,
    columns: number,
    rows = 24,
): Profile {
    if (!shape) return solidProfile(columns);

    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // The shape's own box, taking width 1 so everything stays proportional.
    const localWidth = 1;
    const localHeight = 1 / Math.max(0.0001, aspect);
    const sweptWidth = localWidth * Math.abs(cos) + localHeight * Math.abs(sin);
    const sweptHeight = localWidth * Math.abs(sin) + localHeight * Math.abs(cos);

    const top = new Float32Array(columns).fill(1);
    const bottom = new Float32Array(columns).fill(0);
    const filled = new Uint8Array(columns);

    for (let column = 0; column < columns; column++) {
        // Offset from the swept box's centre, which is also the shape's centre.
        const dx = ((column + 0.5) / columns - 0.5) * sweptWidth;
        for (let row = 0; row < rows; row++) {
            const dy = ((row + 0.5) / rows - 0.5) * sweptHeight;
            // Rotate back into the shape's frame.
            const lx = dx * cos + dy * sin;
            const ly = -dx * sin + dy * cos;
            const u = lx / localWidth + 0.5;
            const v = ly / localHeight + 0.5;
            if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
            const cell = shape.cells[
                Math.min(shape.rows - 1, Math.floor(v * shape.rows)) * shape.columns
                + Math.min(shape.columns - 1, Math.floor(u * shape.columns))];
            if (!cell) continue;
            // The whole cell is opaque, not just the point that was sampled.
            // Recording the sample centres instead makes every shape a row
            // thinner than it is at both ends, so even a solid rectangle
            // reports itself smaller than its own box.
            if (!filled[column] || row / rows < top[column]) top[column] = row / rows;
            if ((row + 1) / rows > bottom[column]) bottom[column] = (row + 1) / rows;
            filled[column] = 1;
        }
    }

    // A shape whose mask turned out to be empty — a fully transparent cut-out,
    // or a mask that could not be read — must not vanish from the packing.
    if (!filled.some(f => f)) return solidProfile(columns);
    return { columns, top, bottom, filled };
}

/** The profile value at a fraction across the box, for resampling. */
export function sampleProfile(profile: Profile, at: number): { top: number; bottom: number; filled: boolean } {
    const index = Math.min(profile.columns - 1, Math.max(0, Math.floor(at * profile.columns)));
    return {
        top: profile.top[index],
        bottom: profile.bottom[index],
        filled: profile.filled[index] === 1,
    };
}
