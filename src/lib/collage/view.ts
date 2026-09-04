/**
 * Moving the camera: the arithmetic the wheel and two fingers share.
 *
 * Kept out of the canvas because it is the one part of panning that is easy to
 * get subtly wrong — the canvas point under the pointer has to stay under it,
 * or zooming walks the world sideways — and the only way to know it is right
 * is to assert it.
 *
 * Screen coordinates here are relative to the viewport, not the page.
 */
export interface View {
    x: number;
    y: number;
    zoom: number;
}

/**
 * Past 2.5x a sticker is a texture study; below a quarter the world is dust.
 * The camera's own scene framing stays inside the same band.
 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;

const clamp = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Where a screen point falls on the canvas. */
export function canvasPointOf(view: View, at: { x: number; y: number }) {
    return { x: (at.x - view.x) / view.zoom, y: (at.y - view.y) / view.zoom };
}

/** Zoom about a point: whatever is under it stays under it. */
export function zoomAbout(view: View, at: { x: number; y: number }, factor: number): View {
    const zoom = clamp(view.zoom * factor);
    const scale = zoom / view.zoom;
    return {
        zoom,
        x: at.x - (at.x - view.x) * scale,
        y: at.y - (at.y - view.y) * scale,
    };
}

/** Two fingers, as they were and as they are now. */
export interface Grip {
    /** How far apart they are. Never zero — two fingers on one pixel would scale by infinity. */
    gap: number;
    /** The point between them. */
    x: number;
    y: number;
}

export function gripOf(a: { x: number; y: number }, b: { x: number; y: number }): Grip {
    return {
        gap: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    };
}

/**
 * A pinch: zoom by how far the fingers spread, pan by where their middle went.
 * Measured against the view the gesture STARTED from, so a long pinch cannot
 * accumulate rounding drift.
 */
export function pinched(start: View, from: Grip, to: Grip): View {
    const zoom = clamp(start.zoom * (to.gap / from.gap));
    const scale = zoom / start.zoom;
    return {
        zoom,
        x: to.x - (from.x - start.x) * scale,
        y: to.y - (from.y - start.y) * scale,
    };
}
