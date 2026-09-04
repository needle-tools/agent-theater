import { describe, it, expect } from "vitest";
import { canvasPointOf, gripOf, pinched, zoomAbout, ZOOM_MAX, ZOOM_MIN } from "../src/lib/collage/view.js";

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
};

describe("zooming about a point", () => {
    it("keeps whatever is under the pointer under it", () => {
        const view = { x: -300, y: 120, zoom: 0.8 };
        const at = { x: 400, y: 250 };
        const before = canvasPointOf(view, at);
        near(canvasPointOf(zoomAbout(view, at, 1.6), at), before);
        near(canvasPointOf(zoomAbout(view, at, 0.4), at), before);
    });

    it("stops at the ends of the band instead of running away", () => {
        const view = { x: 0, y: 0, zoom: 1 };
        expect(zoomAbout(view, { x: 0, y: 0 }, 100).zoom).toBe(ZOOM_MAX);
        expect(zoomAbout(view, { x: 0, y: 0 }, 0.001).zoom).toBe(ZOOM_MIN);
    });
});

describe("pinching", () => {
    const start = { x: -100, y: 40, zoom: 0.9 };

    it("keeps the canvas point between the fingers between them", () => {
        const from = gripOf({ x: 300, y: 400 }, { x: 500, y: 400 });
        const to = gripOf({ x: 250, y: 400 }, { x: 650, y: 400 });
        const held = canvasPointOf(start, { x: from.x, y: from.y });
        near(canvasPointOf(pinched(start, from, to), { x: to.x, y: to.y }), held);
    });

    it("spreading zooms in, closing zooms out", () => {
        const from = gripOf({ x: 300, y: 400 }, { x: 500, y: 400 });
        expect(pinched(start, from, gripOf({ x: 200, y: 400 }, { x: 600, y: 400 })).zoom)
            .toBeCloseTo(start.zoom * 2, 6);
        expect(pinched(start, from, gripOf({ x: 350, y: 400 }, { x: 450, y: 400 })).zoom)
            .toBeCloseTo(start.zoom * 0.5, 6);
    });

    it("pans when the fingers move without spreading", () => {
        const from = gripOf({ x: 300, y: 400 }, { x: 500, y: 400 });
        const to = gripOf({ x: 340, y: 430 }, { x: 540, y: 430 });
        const after = pinched(start, from, to);
        expect(after.zoom).toBeCloseTo(start.zoom, 6);
        near(after, { x: start.x + 40, y: start.y + 30 });
    });

    it("survives two fingers landing on the same pixel", () => {
        const from = gripOf({ x: 400, y: 400 }, { x: 400, y: 400 });
        expect(Number.isFinite(pinched(start, from, from).zoom)).toBe(true);
    });
});
