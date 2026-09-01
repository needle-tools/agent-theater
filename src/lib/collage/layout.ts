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

export const LAYOUT_MODES = ["grid", "row", "column", "ring", "scatter", "packed"] as const;
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
        case "scatter": return scatter(layers, inner, options);
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

/** Loose overlapping placement with a tilt — the pile-of-photos look. */
function scatter(layers: Layer[], area: Rect, options: LayoutOptions): Placement[] {
    const random = mulberry32(options.seed ?? 1);
    const jitter = options.jitter ?? 12;
    // Sized so a handful covers the frame without any one dominating it.
    const slot = Math.min(area.width, area.height) / Math.max(1.6, Math.sqrt(layers.length) * 1.1);
    return layers.map(layer => {
        const scaled = scaleToFit(layer, slot * (0.75 + random() * 0.5), slot * (0.75 + random() * 0.5));
        return {
            id: layer.id,
            x: area.x + random() * Math.max(0, area.width - scaled.width),
            y: area.y + random() * Math.max(0, area.height - scaled.height),
            width: scaled.width,
            height: scaled.height,
            rotation: (random() * 2 - 1) * jitter,
        };
    });
}

/**
 * Shelf packing: tallest first, filled into rows, then the whole block is
 * scaled once to fit the area. Denser than a grid and it keeps every item's
 * aspect ratio, which is what makes a magazine page look packed rather than
 * gridded.
 */
function packed(layers: Layer[], area: Rect, gap: number): Placement[] {
    const spacing = Math.min(area.width, area.height) * gap * 0.25;
    // Normalise to a common height first, so the shelves come out even.
    const unit = area.height / Math.max(2, Math.ceil(Math.sqrt(layers.length)));
    const items = layers
        .map(layer => {
            const aspect = layer.width / layer.height;
            return { layer, width: unit * aspect, height: unit };
        })
        .sort((a, b) => b.width - a.width);

    const rows: Array<{ items: typeof items; width: number }> = [];
    for (const item of items) {
        const row = rows.find(r => r.width + item.width + spacing <= area.width);
        if (row) {
            row.items.push(item);
            row.width += item.width + spacing;
        } else {
            rows.push({ items: [item], width: item.width });
        }
    }

    const totalHeight = rows.length * unit + (rows.length - 1) * spacing;
    const scale = Math.min(1, area.height / totalHeight);
    const placements: Placement[] = [];
    let y = area.y + (area.height - totalHeight * scale) / 2;
    for (const row of rows) {
        let x = area.x + (area.width - row.width * scale) / 2;
        for (const item of row.items) {
            placements.push({
                id: item.layer.id,
                x,
                y,
                width: item.width * scale,
                height: item.height * scale,
                rotation: 0,
            });
            x += (item.width + spacing) * scale;
        }
        y += (unit + spacing) * scale;
    }
    return placements;
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
