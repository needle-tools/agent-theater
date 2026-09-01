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
import { profileOf, sampleProfile, type Profile, type Shape } from "./silhouette.js";

/** Vertical slices per shape. Enough to catch a concavity, cheap to search. */
const PROFILE_COLUMNS = 24;

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
    /**
     * What a packing layout solves its scale for.
     *
     * True: fill the area — right for a chosen paper size, where covering the
     * page is the point. False: keep the total amount of artwork exactly as it
     * is — right for the free canvas, which has no size of its own. Filling
     * there closes a loop, because the page is refitted to the contents, so the
     * collage loses a few percent on every single arrange.
     *
     * Either way sizes are assigned rather than adjusted, so arranging twice
     * gives the same answer twice.
     */
    fill?: boolean;
    /**
     * The silhouette of each layer, by id, for the packing layouts.
     *
     * Optional because the shapes come from decoded pixels and this module has
     * no browser in it. Without them a layer packs as its box, which is correct
     * — just looser. Text layers never have one, and neither does an image
     * whose pixels have not been read.
     */
    shapes?: Map<string, Shape>;
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
 * The specimen plate: everything packed tight, nothing on top of anything.
 *
 * This used to be a grid of deliberately oversized cells, which piled the
 * cut-outs on each other and left the corners bare. A collage of cut-outs
 * wants the opposite — the appeal is *seeing all of them*, each whole, each
 * given exactly as much room as it needs and no more. Overlap hides the very
 * thing that made cutting them out worth doing.
 *
 * So: a skyline packer. The frontier is the profile of everything placed so
 * far; each next item goes wherever that profile is lowest, which is what
 * makes items slide sideways into the gap under a tall neighbour instead of
 * starting a new row. Big things first, because a small item can fill a hole a
 * big one could never have fitted into.
 *
 * Everything is tilted, and packing does not fight that: what gets packed is
 * each item's SWEPT box, the footprint the tilt actually occupies. Reserve that
 * and the corners have somewhere to go, so the pack stays gap-free with nothing
 * overlapping and nothing hanging off the edge. Packing the upright box instead
 * is the mistake that makes tilt and tight packing look incompatible.
 *
 * The result reads as irregular, but nothing here is random except which item
 * is which size and which way it leans. The texture comes from the shapes
 * disagreeing.
 */
function collage(layers: Layer[], area: Rect, gap: number, options: LayoutOptions): Placement[] {
    const random = mulberry32(options.seed ?? 7);
    // Gutters are deliberately tight. This is the difference between a plate of
    // specimens and a noticeboard.
    const spacing = Math.min(area.width, area.height) * gap * 0.05;

    const jitter = options.jitter ?? 8;

    // A wall of identically-sized cut-outs reads as a contact sheet, so each
    // gets a seeded weight and a seeded tilt. Both are drawn before sorting, so
    // the same seed gives the same picture whatever order the layers arrive in.
    //
    // The weight is skewed hard towards the small end rather than spread evenly.
    // An even spread gives every item roughly the same area, and a page of
    // same-sized things in rows is a grid however irregular the rows are. A few
    // big and many small is what makes a plate look collected.
    //
    // How far that goes depends on how many there are. A long tail needs a
    // crowd to sit in: across fifty cut-outs the tiny ones read as detail, but
    // across six they read as three pictures and three specks.
    const variety = clamp(layers.length / 24, 0.3, 1);
    const items = layers.map(layer => {
        const rotation = (random() * 2 - 1) * jitter;
        const aspect = Math.max(0.05, layer.width / Math.max(1, layer.height));
        return {
            layer,
            weight: 1 + variety * (0.34 + Math.pow(random(), 2.1) * 2.3 - 1),
            rotation,
            aspect,
            // Computed once: the tilt is already decided, and the profile does
            // not depend on the scale, which the search changes a dozen times.
            profile: profileOf(options.shapes?.get(layer.id) ?? null, rotation, aspect, PROFILE_COLUMNS),
        };
    });
    // Tallest first — the standard heuristic, and the reason the packing is
    // dense rather than merely non-overlapping.
    const ordered = [...items].sort((a, b) =>
        (b.weight / Math.sqrt(b.aspect)) - (a.weight / Math.sqrt(a.aspect)));

    const fill = options.fill ?? true;

    /**
     * Pack every item at `scale`, returning where they went and how tall it got.
     *
     * `into` is the width to pack against: the area's width when filling a
     * page, and a computed one on the free canvas, which has no width of its own.
     */
    const packAt = (scale: number, into: number) => {
        const skyline = new ShapeSkyline(into);
        const placements: Placement[] = [];
        for (const item of ordered) {
            // Size comes from the weight and the scale alone — never from the
            // size the item already has. Multiplying by the current width
            // compounds: the same seeded weight applies again every pass, so
            // heavy items grow and light ones shrink until the spread is
            // absurd, and nothing looks wrong until the fifth arrange.
            //
            // What gets packed is the SWEPT box — the footprint a tilted item
            // actually occupies. Packing the upright box instead is what makes
            // people think tilt and tight packing are incompatible: they are
            // not, you just have to reserve the space the tilt uses.
            const swept = (w: number) => sweptSize({ width: w, height: w / item.aspect }, item.rotation);
            let width = item.weight * scale;
            // A wide item tilted is wider still; shrink until its footprint fits.
            if (swept(width).width > into) width *= into / swept(width).width;
            const height = width / item.aspect;
            const footprint = swept(width);

            // The footprint is the box, but the *profile* is the shape inside
            // it — where the opaque pixels start and stop in each vertical
            // slice. Passing that is what lets a neighbour settle into a
            // concavity rather than resting on the empty corner above it.
            const spot = skyline.place(
                footprint.width + spacing,
                footprint.height + spacing,
                item.profile);
            placements.push({
                id: item.layer.id,
                // Centred in its footprint. A rotated layer's bounds grow about
                // its centre, which is what keeps the tilted corners in the
                // space that was reserved for them.
                x: area.x + spot.x + (footprint.width - width) / 2,
                y: area.y + spot.y + (footprint.height - height) / 2,
                width,
                height,
                rotation: item.rotation,
            });
        }
        return { placements, height: skyline.top() - spacing };
    };

    let best: { placements: Placement[]; height: number };

    if (fill) {
        // How big should everything be? Solve it rather than guess: start from
        // the scale at which the artwork would just cover the page, then search
        // for the largest scale whose packed height still fits inside it.
        //
        // The search is what makes repeated arranging safe. Scaling the block
        // by height alone overshoots — area goes as the square — so it came out
        // smaller every pass. Here the second pass finds the same scale as the
        // first and nothing moves.
        const artwork = items.reduce((sum, i) => sum + (i.weight * i.weight) / i.aspect, 0);
        const guess = Math.sqrt((area.width * area.height * 0.82) / Math.max(0.0001, artwork));

        let low = guess * 0.25;
        let high = guess * 2.2;
        best = packAt(low, area.width);
        for (let step = 0; step < 12; step++) {
            const mid = (low + high) / 2;
            const attempt = packAt(mid, area.width);
            if (attempt.height <= area.height) {
                best = attempt;
                low = mid;
            } else {
                high = mid;
            }
        }
    } else {
        // The free canvas has no page to fill, so the scale is solved for a
        // different thing: keep the total amount of artwork exactly as it was.
        //
        // That is what makes repeated arranging safe here. Filling the area
        // instead closes a loop — the page is refitted to the contents, the
        // layout fills a fraction of the page, the page refits to that — and
        // the collage loses a few percent every time. Preserving the total has
        // no such loop: pass two computes the same scale as pass one, exactly.
        const artwork = items.reduce((sum, i) => sum + i.layer.width * (i.layer.width / i.aspect), 0);
        const unit = items.reduce((sum, i) => sum + (i.weight * i.weight) / i.aspect, 0);
        const scale = Math.sqrt(artwork / Math.max(0.0001, unit));
        const aspect = clamp(area.width / Math.max(1, area.height), 0.4, 2.5);
        const width = Math.max(
            Math.max(...items.map(i => i.weight * scale)),
            Math.sqrt((artwork / 0.86) * aspect));
        best = packAt(scale, width);
    }

    // Centre the block on the area. The pack grows right and down from its
    // origin, so without this it would sit against the top left corner.
    //
    // Measured across the tilted corners, not the upright boxes: centring on
    // the upright ones leaves a rotated item at the edge hanging over it.
    const packed = sweptBounds(best.placements);
    if (!packed) return best.placements;
    const dx = area.x + (area.width - packed.width) / 2 - packed.x;
    const dy = area.y + (area.height - packed.height) / 2 - packed.y;
    return best.placements.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

/**
 * The frontier of a packing: how high the work reaches at each column.
 *
 * A height map rather than a list of rectangles, because what settles onto it
 * is a shape, not a box. Each item arrives with a profile — where its opaque
 * pixels start and stop in every vertical slice — and the resting height is
 * whatever lets each slice touch the work below it. That is what makes a small
 * pot come to rest between a plant's leaves instead of on top of the box that
 * contains them.
 *
 * The resolution is the one real approximation here. It is a packing, not a
 * collision test, and the canvas has already been told these shapes may touch.
 */
class ShapeSkyline {
    private readonly heights: Float64Array;
    private readonly column: number;

    constructor(private readonly width: number, resolution = 180) {
        this.heights = new Float64Array(Math.max(8, resolution));
        this.column = width / this.heights.length;
    }

    /**
     * Where a shape of this size and profile comes to rest.
     *
     * "Lowest, then leftmost" is the textbook rule and it is what made this
     * look like a grid: everything that could not slot into a hole went to the
     * left margin, so the pack grew as left-aligned shelves. Lowest still wins
     * — that is what fills holes — but ties are broken by which position wastes
     * the least, measured as the gap left between the shape's underside and the
     * work beneath it. A snug hole beats an open shelf, so items seek each
     * other out rather than queueing along an edge.
     */
    place(width: number, height: number, profile: Profile): { x: number; y: number } {
        const w = Math.min(width, this.width);
        const span = Math.max(1, Math.min(this.heights.length, Math.round(w / this.column)));
        // Where the shape's top and bottom sit in each column it covers, as
        // distances from the top of its swept box.
        const top: number[] = [];
        const bottom: number[] = [];
        for (let i = 0; i < span; i++) {
            const sample = sampleProfile(profile, (i + 0.5) / span);
            top.push(sample.filled ? sample.top * height : Infinity);
            bottom.push(sample.filled ? sample.bottom * height : 0);
        }

        let best: { start: number; y: number; waste: number } | null = null;
        for (let start = 0; start + span <= this.heights.length; start++) {
            let y = 0;
            for (let i = 0; i < span; i++) {
                // An empty column rests on nothing: a neighbour may pass
                // straight through it, which is the whole point of a profile.
                if (top[i] === Infinity) continue;
                y = Math.max(y, this.heights[start + i] - top[i]);
            }
            let waste = 0;
            for (let i = 0; i < span; i++) {
                if (top[i] === Infinity) continue;
                waste += (y + top[i]) - this.heights[start + i];
            }
            if (!best || y < best.y - 1e-6 || (y < best.y + 1e-6 && waste < best.waste - 1e-6)) {
                best = { start, y, waste };
            }
        }

        const spot = best ?? { start: 0, y: this.top(), waste: 0 };
        for (let i = 0; i < span; i++) {
            if (top[i] === Infinity) continue;
            this.heights[spot.start + i] = spot.y + bottom[i];
        }
        return { x: spot.start * this.column, y: spot.y };
    }

    /** The highest point of the frontier — the packed block's height. */
    top(): number {
        let highest = 0;
        for (const height of this.heights) if (height > highest) highest = height;
        return highest;
    }
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
/** The box around a set of placements, counting the corners of tilted ones. */
function sweptBounds(placements: Placement[]): Rect | null {
    if (!placements.length) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of placements) {
        const swept = sweptSize(p, p.rotation);
        const cx = p.x + p.width / 2;
        const cy = p.y + p.height / 2;
        left = Math.min(left, cx - swept.width / 2);
        top = Math.min(top, cy - swept.height / 2);
        right = Math.max(right, cx + swept.width / 2);
        bottom = Math.max(bottom, cy + swept.height / 2);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

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
