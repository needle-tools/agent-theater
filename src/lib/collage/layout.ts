/**
 * Arrangements.
 *
 * An agent placing a dozen cut-outs by coordinate is doing arithmetic it cannot
 * check — it never sees the result until it asks for a preview, and by then the
 * damage is done. So the layouts live here, as one call: say "grid", get a grid
 * that already fits the frame and already respects every image's aspect ratio.
 *
 * Every mode is deterministic. `scatter` takes a seed rather than reaching for
 * Math.random, so "that looked good, but nudge the third one" does not reshuffle
 * the other eleven — and so the tests can assert on actual numbers.
 */
import { bounds, unionBounds, type Layer, type Rect } from "./model.js";

export const LAYOUT_MODES = ["grid", "row", "column", "ring", "scatter", "packed", "collage"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export interface LayoutOptions {
    /** Fraction of the area kept clear at the edges. 0–0.4. */
    padding?: number;
    /** Fraction of a cell left as breathing room between items. 0–0.5. */
    gap?: number;
    /** Seed for `scatter`, so the same call twice gives the same picture. */
    seed?: number;
    /** Max degrees of tilt for `scatter`. */
    jitter?: number;
}

export interface Placement {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}

export function arrange(layers: Layer[], area: Rect, mode: LayoutMode, options: LayoutOptions = {}): Placement[] {
    if (!layers.length) return [];
    const padding = clamp(options.padding ?? 0.06, 0, 0.4);
    const gap = clamp(options.gap ?? 0.08, 0, 0.5);
    const inner: Rect = {
        x: area.x + area.width * padding,
        y: area.y + area.height * padding,
        width: area.width * (1 - padding * 2),
        height: area.height * (1 - padding * 2),
    };

    switch (mode) {
        case "row": return cells(layers, inner, layers.length, 1, gap);
        case "column": return cells(layers, inner, 1, layers.length, gap);
        case "ring": return ring(layers, inner, gap);
        case "scatter": return scatter(layers, inner, gap, options);
        case "collage": return collage(layers, inner, gap, options);
        case "packed": return packed(layers, inner, gap);
        case "grid":
        default: {
            // Choose the column count whose resulting cells are closest to the
            // average image's aspect ratio — a grid of portraits wants more
            // columns than a grid of landscapes, at the same item count.
            const target = averageAspect(layers);
            let best = { columns: 1, error: Infinity };
            for (let columns = 1; columns <= layers.length; columns++) {
                const rows = Math.ceil(layers.length / columns);
                const cellAspect = (inner.width / columns) / (inner.height / rows);
                const error = Math.abs(Math.log(cellAspect / target));
                if (error < best.error) best = { columns, error };
            }
            return cells(layers, inner, best.columns, Math.ceil(layers.length / best.columns), gap);
        }
    }
}

/** Lay items out in a columns×rows grid, each contained in its cell. */
function cells(layers: Layer[], area: Rect, columns: number, rows: number, gap: number): Placement[] {
    const cellWidth = area.width / columns;
    const cellHeight = area.height / rows;
    return layers.map((layer, i) => {
        const cell: Rect = {
            x: area.x + (i % columns) * cellWidth,
            y: area.y + Math.floor(i / columns) * cellHeight,
            width: cellWidth,
            height: cellHeight,
        };
        return { ...containIn(layer, shrink(cell, gap)), rotation: 0 };
    });
}

/** Items evenly around an ellipse inscribed in the area, facing outward. */
function ring(layers: Layer[], area: Rect, gap: number): Placement[] {
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    // Items are drawn centred on the ring, so the radius must leave room for
    // half an item on both sides or the outer ones hang off the frame.
    const slot = Math.min(area.width, area.height) / Math.max(3, layers.length) * (1 - gap) * 2;
    const radiusX = (area.width - slot) / 2;
    const radiusY = (area.height - slot) / 2;
    return layers.map((layer, i) => {
        const angle = (i / layers.length) * Math.PI * 2 - Math.PI / 2;
        const scaled = scaleToFit(layer, slot, slot);
        return {
            id: layer.id,
            x: centerX + Math.cos(angle) * radiusX - scaled.width / 2,
            y: centerY + Math.sin(angle) * radiusY - scaled.height / 2,
            width: scaled.width,
            height: scaled.height,
            rotation: 0,
        };
    });
}

/**
 * Even coverage with a tilt — the pile-of-photos look.
 *
 * A jittered grid rather than random placement. Uniform random *clumps*: with
 * a dozen items you reliably get three in one corner and a bare patch in the
 * middle, which reads as a bug rather than as looseness. One item per cell,
 * offset within it, keeps the spread even and keeps everything inside the
 * frame — the randomness is in the offset, not in the position.
 */
function scatter(layers: Layer[], area: Rect, gap: number, options: LayoutOptions): Placement[] {
    const random = mulberry32(options.seed ?? 1);
    const jitter = options.jitter ?? 10;
    const { columns, rows } = gridShape(layers.length, area);
    const cellWidth = area.width / columns;
    const cellHeight = area.height / rows;
    // Big enough to fill the cell with room to tilt, so a rotated item does not
    // stick out past the edge.
    const slot = Math.min(cellWidth, cellHeight) * (1 - gap * 0.5);

    return shuffled(layers, random).map((layer, i) => {
        const scaled = scaleToFit(layer, slot * (0.82 + random() * 0.36), slot * (0.82 + random() * 0.36));
        const rotation = (random() * 2 - 1) * jitter;
        const swept = sweptSize(scaled, rotation);
        const cellX = area.x + (i % columns) * cellWidth;
        const cellY = area.y + Math.floor(i / columns) * cellHeight;
        // Slack is what is left in the cell once the tilted item is inside it.
        const slackX = Math.max(0, cellWidth - swept.width);
        const slackY = Math.max(0, cellHeight - swept.height);
        return {
            id: layer.id,
            x: cellX + slackX * random() + (swept.width - scaled.width) / 2,
            y: cellY + slackY * random() + (swept.height - scaled.height) / 2,
            width: scaled.width,
            height: scaled.height,
            rotation,
        };
    });
}

/**
 * The actual collage look: overlapping, tilted, unevenly sized.
 *
 * The difference from `scatter` is that this one is *composed*. Items are
 * sized by distance from the centre, so the middle of the frame carries the
 * biggest picture and the edges get the smaller ones — which is what makes a
 * collage read as having a subject rather than as a pile. Cells deliberately
 * overlap, because a collage with visible gutters is just an untidy grid.
 */
function collage(layers: Layer[], area: Rect, gap: number, options: LayoutOptions): Placement[] {
    const random = mulberry32(options.seed ?? 7);
    const jitter = options.jitter ?? 9;
    const { columns, rows } = gridShape(layers.length, area);
    // Overlap rather than separate: cells are wider than their share.
    const spread = 1 + (1 - gap) * 0.22;
    const cellWidth = (area.width / columns) * spread;
    const cellHeight = (area.height / rows) * spread;
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    const maxDistance = Math.hypot(area.width, area.height) / 2;

    return shuffled(layers, random).map((layer, i) => {
        // Cells are oversized, so they have to be re-anchored to keep the block
        // centred on the frame rather than spilling off the bottom right.
        const cellX = area.x + (i % columns) * ((area.width - cellWidth) / Math.max(1, columns - 1));
        const cellY = area.y + Math.floor(i / columns) * ((area.height - cellHeight) / Math.max(1, rows - 1));
        const cx = cellX + cellWidth / 2;
        const cy = cellY + cellHeight / 2;
        // 1 at the centre, ~0 at the corners.
        const closeness = 1 - Math.min(1, Math.hypot(cx - centerX, cy - centerY) / maxDistance);
        const emphasis = 0.72 + closeness * 0.5 + random() * 0.14;
        const slot = Math.min(cellWidth, cellHeight) * emphasis;
        const scaled = scaleToFit(layer, slot, slot);
        return {
            id: layer.id,
            x: cx - scaled.width / 2 + (random() * 2 - 1) * cellWidth * 0.08,
            y: cy - scaled.height / 2 + (random() * 2 - 1) * cellHeight * 0.08,
            width: scaled.width,
            height: scaled.height,
            rotation: (random() * 2 - 1) * jitter,
        };
    });
}

/**
 * Justified rows — the magazine layout.
 *
 * Every row is exactly the frame's width and every item in a row shares a
 * height, so the block has clean edges on both sides and no ragged gutter.
 * That is the whole trick: pick how many items go in a row, then solve for the
 * height that makes them fill it, rather than picking a height and hoping.
 *
 * The previous version scaled the finished block by height alone, so a wide
 * row could still hang off the side. It now scales by whichever axis is
 * tighter, which is why nothing overflows any more.
 */
function packed(layers: Layer[], area: Rect, gap: number): Placement[] {
    const spacing = Math.min(area.width, area.height) * gap * 0.22;
    const items = layers.map(layer => ({ layer, aspect: Math.max(0.05, layer.width / Math.max(1, layer.height)) }));

    // Start from the height at which n items of the average shape would just
    // fill the area, then let the row solver correct it.
    const averageAspect = items.reduce((sum, i) => sum + i.aspect, 0) / items.length;
    const targetHeight = Math.sqrt((area.width * area.height) / (items.length * averageAspect));

    const rows: Array<{ items: typeof items; height: number }> = [];
    let current: typeof items = [];
    let aspectSum = 0;
    for (const item of items) {
        current.push(item);
        aspectSum += item.aspect;
        const width = aspectSum * targetHeight + spacing * (current.length - 1);
        if (width >= area.width) {
            // Solve for the height that makes this row exactly fill the width.
            rows.push({ items: current, height: (area.width - spacing * (current.length - 1)) / aspectSum });
            current = [];
            aspectSum = 0;
        }
    }
    if (current.length) {
        // The last row is usually short. Filling the width would blow it up to
        // a size the rest of the page cannot answer, so it keeps the target
        // height and is centred instead.
        rows.push({ items: current, height: Math.min(targetHeight, (area.width - spacing * (current.length - 1)) / aspectSum) });
    }

    const blockHeight = rows.reduce((sum, r) => sum + r.height, 0) + spacing * (rows.length - 1);
    // Scale by whichever axis runs out first — the fix for rows hanging off.
    const scale = Math.min(1, area.height / blockHeight);

    const placements: Placement[] = [];
    let y = area.y + (area.height - blockHeight * scale) / 2;
    for (const row of rows) {
        const height = row.height * scale;
        const rowWidth = row.items.reduce((sum, i) => sum + i.aspect * height, 0) + spacing * scale * (row.items.length - 1);
        let x = area.x + (area.width - rowWidth) / 2;
        for (const item of row.items) {
            const width = item.aspect * height;
            placements.push({ id: item.layer.id, x, y, width, height, rotation: 0 });
            x += width + spacing * scale;
        }
        y += height + spacing * scale;
    }
    return placements;
}

/** Rows and columns whose cells are closest to the area's own proportions. */
function gridShape(count: number, area: Rect): { columns: number; rows: number } {
    const columns = Math.max(1, Math.round(Math.sqrt(count * (area.width / Math.max(1, area.height)))));
    return { columns: Math.min(count, columns), rows: Math.ceil(count / Math.min(count, columns)) };
}

/** Axis-aligned size of a box once it is tilted. */
function sweptSize(size: { width: number; height: number }, rotation: number) {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    return {
        width: size.width * cos + size.height * sin,
        height: size.width * sin + size.height * cos,
    };
}

/**
 * Deterministic shuffle, so the biggest picture does not always land in the
 * same cell just because it happened to be added first.
 */
function shuffled<T>(items: T[], random: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** Largest size with the layer's aspect ratio that fits, centred in the rect. */
function containIn(layer: Layer, rect: Rect): Omit<Placement, "rotation"> {
    const scaled = scaleToFit(layer, rect.width, rect.height);
    return {
        id: layer.id,
        x: rect.x + (rect.width - scaled.width) / 2,
        y: rect.y + (rect.height - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
    };
}

function scaleToFit(layer: Layer, maxWidth: number, maxHeight: number) {
    const scale = Math.min(maxWidth / layer.width, maxHeight / layer.height);
    return { width: layer.width * scale, height: layer.height * scale };
}

function shrink(rect: Rect, fraction: number): Rect {
    const insetX = (rect.width * fraction) / 2;
    const insetY = (rect.height * fraction) / 2;
    return {
        x: rect.x + insetX,
        y: rect.y + insetY,
        width: Math.max(1, rect.width - insetX * 2),
        height: Math.max(1, rect.height - insetY * 2),
    };
}

function averageAspect(layers: Layer[]): number {
    // Geometric mean: aspect ratios are multiplicative, so 2 and 1/2 should
    // average to 1 rather than to 1.25.
    const sum = layers.reduce((total, l) => total + Math.log(l.width / Math.max(1, l.height)), 0);
    return Math.exp(sum / layers.length);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Small, fast, seedable PRNG. Reproducibility is the only requirement. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Bounding box of a set of placements — used to fit a frame around them. */
export function placementBounds(placements: Placement[]): Rect | null {
    return unionBounds(placements.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height })));
}

export { bounds };
