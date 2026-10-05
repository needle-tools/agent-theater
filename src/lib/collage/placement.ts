/**
 * Where and how big a new sticker should arrive, so it JOINS the world.
 *
 * Two rules, shared by every door a piece can come through (the agent's
 * troupe adds, clones, the person's shelf):
 *
 * - Sized like its neighbours: the median of the image pieces already lying
 *   on the paper. "The right size" is a property of the arrangement, not of
 *   the sheet the piece was cut from.
 * - Placed on clear paper near the arrangement: ring-search outward from a
 *   starting point until nothing is underneath. A pile of overlapping
 *   stickers is the one thing every add used to produce, and un-stacking
 *   them is a chore nobody asked for.
 */
import { bounds, type Layer } from "./model.js";

/** Median width of the sticker-sized image pieces on the canvas. */
export function peerWidth(layers: Layer[], fallback: number, ceiling = 900): number {
    const peers = layers
        .filter(layer => layer.kind === "image" && layer.width < ceiling)
        .map(layer => layer.width)
        .sort((a, b) => a - b);
    return peers.length ? Math.round(peers[Math.floor(peers.length / 2)]) : fallback;
}

/**
 * The nearest clear patch of paper to `near`, checked against every layer.
 * Deterministic enough to feel placed, loose enough to read as strewn.
 */
export function clearSpot(
    layers: Layer[],
    near: { x: number; y: number },
    size: number,
): { x: number; y: number } {
    const others = layers.map(layer => ({
        x: layer.x + layer.width / 2,
        y: layer.y + layer.height / 2,
        girth: Math.min(layer.width, layer.height),
    }));
    const free = (x: number, y: number) =>
        others.every(other =>
            Math.hypot(other.x - x, other.y - y) > (other.girth + size) / 2 * 0.9);
    if (free(near.x, near.y)) return near;
    for (let ring = 1; ring <= 16; ring++) {
        const reach = ring * size * 0.55;
        for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2 + ring * 0.7;
            const x = near.x + Math.cos(angle) * reach;
            const y = near.y + Math.sin(angle) * reach;
            if (free(x, y)) return { x, y };
        }
    }
    return near;
}

/** Find room for the actual visible rectangle of a new cut-out. */
export function clearRectSpot(
    layers: Layer[],
    near: { x: number; y: number },
    size: { width: number; height: number },
    gap = 24,
): { x: number; y: number } {
    const others = layers.map(bounds);
    const free = (x: number, y: number) => others.every(other =>
        x + size.width / 2 + gap <= other.x ||
        x - size.width / 2 - gap >= other.x + other.width ||
        y + size.height / 2 + gap <= other.y ||
        y - size.height / 2 - gap >= other.y + other.height);
    if (free(near.x, near.y)) return near;
    const stride = Math.max(size.width, size.height, 100) * 0.6;
    for (let ring = 1; ring <= 32; ring++) {
        const reach = ring * stride;
        const steps = Math.max(12, Math.ceil(2 * Math.PI * reach / stride));
        for (let step = 0; step < steps; step++) {
            const angle = (step / steps) * Math.PI * 2 + ring * 0.7;
            const x = near.x + Math.cos(angle) * reach;
            const y = near.y + Math.sin(angle) * reach;
            if (free(x, y)) return { x, y };
        }
    }
    // The normal search covers even busy stages. A finite fallback still keeps
    // the newcomer separate from everything already on the paper.
    return {
        x: Math.max(...others.map(other => other.x + other.width), near.x) + gap + size.width / 2,
        y: near.y,
    };
}

/**
 * A width that reins a newcomer's HEIGHT in line with its peers.
 *
 * Sizing by width alone is how a pencil towers over a sheep: same width,
 * four times the height. What the eye compares is how TALL things stand, so
 * a piece whose height lands far outside the median of the arrangement is
 * scaled back toward it. Returns null when the piece already fits in.
 */
export function tamedWidth(
    piece: { width: number; height: number },
    peers: Layer[],
): number | null {
    if (piece.height <= 0 || piece.width <= 0) return null;
    const heights = peers
        .filter(layer => layer.kind === "image" && layer.width < 900)
        .map(layer => layer.height)
        .sort((a, b) => a - b);
    /*
     * No peers, no opinion. The old fallback compared against a hardcoded
     * 240px "typical" height — which meant the FIRST sticker dropped on an
     * empty canvas was inflated to meet a norm nobody had set, and arrived
     * twice the size of everything adopted after it. Whoever sized the piece
     * before calling this already chose well; conforming is only meaningful
     * once there is an arrangement to conform to.
     */
    if (!heights.length) return null;
    const median = heights[Math.floor(heights.length / 2)];
    if (piece.height <= median * 1.35 && piece.height >= median * 0.45) return null;
    const clamped = Math.min(median * 1.35, Math.max(median * 0.6, piece.height));
    return Math.round(piece.width * (clamped / piece.height));
}

/** The middle of everything on the canvas — where the arrangement lives. */
export function arrangementCentre(layers: Layer[]): { x: number; y: number } {
    if (!layers.length) return { x: 0, y: 0 };
    const xs = layers.map(layer => layer.x + layer.width / 2);
    const ys = layers.map(layer => layer.y + layer.height / 2);
    return {
        x: xs.reduce((a, b) => a + b, 0) / xs.length,
        y: ys.reduce((a, b) => a + b, 0) / ys.length,
    };
}
