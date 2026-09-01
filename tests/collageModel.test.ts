import { describe, it, expect } from "vitest";
import {
    Collage, bounds, outputSize, placementIn, presetCanvasSize, findPreset,
    type Frame, type ImageLayer,
} from "../src/lib/collage/model.js";
import { arrange } from "../src/lib/collage/layout.js";
import { checkFrame } from "../src/lib/collage/quality.js";
import { alphaBounds, alphaCoverage, dominantColors } from "../src/lib/collage/imaging.js";

/**
 * The model is the only thing both the editor and the agent tools mutate, so
 * these tests are about the invariants that keep the two from disagreeing:
 * aspect ratios survive, frames capture by overlap, and export geometry is
 * derived rather than stored.
 */

function collageWith(count: number, size = { width: 400, height: 300 }) {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const layers: ImageLayer[] = [];
    for (let i = 0; i < count; i++) {
        layers.push(collage.addImage({
            src: `https://example.test/${i}.png`,
            natural: size,
            x: i * 50,
            y: 0,
            width: 200,
        }));
    }
    return { collage, layers };
}

describe("layers", () => {
    it("derives height from the cropped aspect ratio, never from the raw image", () => {
        const collage = new Collage();
        // A 1000×1000 PNG whose visible shape is a wide, short strip.
        const layer = collage.addImage({
            src: "data:image/png;base64,x",
            natural: { width: 1000, height: 1000 },
            crop: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
            width: 400,
        });
        // Cropped pixels are 800×200, so the layer must be 4:1.
        expect(layer.width / layer.height).toBeCloseTo(4, 5);
    });

    it("keeps the aspect ratio when only one dimension is set", () => {
        const { collage, layers } = collageWith(1);
        const ratio = layers[0].width / layers[0].height;
        const wider = collage.update(layers[0].id, { width: 600 })!;
        expect(wider.width / wider.height).toBeCloseTo(ratio, 5);
        const taller = collage.update(layers[0].id, { height: 90 })!;
        expect(taller.width / taller.height).toBeCloseTo(ratio, 5);
    });

    it("stacks new layers in front and can reorder them", () => {
        const { collage, layers } = collageWith(3);
        expect(collage.list().map(l => l.id)).toEqual(layers.map(l => l.id));
        collage.sendToBack(layers[2].id);
        expect(collage.list()[0].id).toBe(layers[2].id);
        collage.bringToFront(layers[0].id);
        expect(collage.list().at(-1)!.id).toBe(layers[0].id);
    });

    it("spreads unpositioned layers instead of stacking them at the origin", () => {
        const collage = new Collage();
        const placed = Array.from({ length: 5 }, () =>
            collage.addImage({ src: "x", natural: { width: 100, height: 100 } }));
        const positions = new Set(placed.map(l => `${Math.round(l.x)},${Math.round(l.y)}`));
        expect(positions.size).toBe(placed.length);
    });

    it("accounts for rotation in bounds, so a tilted layer keeps its corners", () => {
        const collage = new Collage();
        const layer = collage.addImage({ src: "x", natural: { width: 100, height: 100 }, x: 0, y: 0, width: 100 });
        const square = bounds(layer);
        const tilted = bounds(collage.update(layer.id, { rotation: 45 })!);
        expect(tilted.width).toBeGreaterThan(square.width);
        expect(tilted.width).toBeCloseTo(Math.sqrt(2) * 100, 3);
    });
});

describe("frames", () => {
    it("sizes A4 so it prints at its real millimetres", () => {
        const preset = findPreset("a4-portrait")!;
        const canvas = presetCanvasSize(preset);
        // 210mm at 96 dpi.
        expect(canvas.width).toBeCloseTo((210 / 25.4) * 96, 3);

        const collage = new Collage();
        const frame = collage.addFrame({ presetId: "a4-portrait" });
        expect(outputSize(frame, 300).width).toBe(2480);
        expect(outputSize(frame, 300).height).toBe(3508);
        expect(outputSize(frame, 72).width).toBe(595);
    });

    it("uses exact pixels for screen presets, whatever the canvas size", () => {
        const collage = new Collage();
        const frame = collage.addFrame({ presetId: "og-1200x630" });
        expect(outputSize(frame)).toEqual({ width: 1200, height: 630 });
    });

    it("captures layers by overlap rather than by assignment", () => {
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const frame = collage.addFrame({ presetId: "square-1080", x: 0, y: 0, width: 500, height: 500 });
        const inside = collage.addImage({ src: "a", natural: { width: 10, height: 10 }, x: 100, y: 100, width: 50 });
        const outside = collage.addImage({ src: "b", natural: { width: 10, height: 10 }, x: 900, y: 900, width: 50 });
        const straddling = collage.addImage({ src: "c", natural: { width: 10, height: 10 }, x: 480, y: 100, width: 50 });

        const ids = collage.layersIn(frame.id).map(l => l.id);
        expect(ids).toContain(inside.id);
        expect(ids).toContain(straddling.id);
        expect(ids).not.toContain(outside.id);
    });

    it("expresses placement as fractions of the frame, so one layer can serve two", () => {
        const collage = new Collage();
        const a4 = collage.addFrame({ presetId: "a4-portrait", x: 0, y: 0, width: 800, height: 1000 });
        const card = collage.addFrame({ presetId: "og-1200x630", x: 0, y: 0, width: 400, height: 200 });
        const layer = collage.addImage({ src: "x", natural: { width: 100, height: 100 }, x: 200, y: 100, width: 100 });

        expect(placementIn(layer, a4).left).toBeCloseTo(0.25, 5);
        expect(placementIn(layer, card).left).toBeCloseTo(0.5, 5);
        // The layer itself holds neither number — it only knows canvas units.
        expect(layer.x).toBe(200);
    });
});

describe("layouts", () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 };

    it("keeps every item inside the area and in its own aspect ratio", () => {
        const { layers } = collageWith(7);
        for (const mode of ["grid", "row", "column", "ring", "packed"] as const) {
            const placements = arrange(layers, area, mode);
            expect(placements).toHaveLength(layers.length);
            for (const p of placements) {
                const source = layers.find(l => l.id === p.id)!;
                expect(p.width / p.height).toBeCloseTo(source.width / source.height, 2);
                expect(p.x).toBeGreaterThanOrEqual(area.x - 1);
                expect(p.y).toBeGreaterThanOrEqual(area.y - 1);
                expect(p.x + p.width).toBeLessThanOrEqual(area.x + area.width + 1);
                expect(p.y + p.height).toBeLessThanOrEqual(area.y + area.height + 1);
            }
        }
    });

    it("scatter is reproducible, so one nudge does not reshuffle the rest", () => {
        const { layers } = collageWith(6);
        const first = arrange(layers, area, "scatter", { seed: 42 });
        const again = arrange(layers, area, "scatter", { seed: 42 });
        const different = arrange(layers, area, "scatter", { seed: 43 });
        expect(again).toEqual(first);
        expect(different).not.toEqual(first);
    });

    it("chooses a column count that suits the images' shape", () => {
        // Six tall portraits in a wide area should not end up in one column.
        const collage = new Collage();
        const portraits = Array.from({ length: 6 }, (_, i) =>
            collage.addImage({ src: `${i}`, natural: { width: 300, height: 900 }, width: 100 }));
        const placements = arrange(portraits, area, "grid");
        const rows = new Set(placements.map(p => Math.round(p.y)));
        expect(rows.size).toBeLessThan(portraits.length);
    });

    it("returns nothing for an empty selection rather than throwing", () => {
        expect(arrange([], area, "grid")).toEqual([]);
    });
});

describe("resolution warnings", () => {
    const frameOf = (collage: Collage, presetId: string) => collage.addFrame({ presetId });

    it("flags a small cut-out placed large on A4", () => {
        const collage = new Collage({ newId: p => `${p}-1` });
        const frame = frameOf(collage, "a4-portrait");
        collage.addImage({
            src: "small.png",
            label: "sneaker",
            natural: { width: 412, height: 390 },
            x: frame.x,
            y: frame.y,
            width: frame.width * 0.6,
        });

        const report = checkFrame(collage.layersIn(frame.id), frame, 300);
        expect(report.worst).toBe("poor");
        expect(report.summary).toContain("sneaker");
        expect(report.layers[0].effectiveDpi).toBeLessThan(150);
    });

    it("passes a cut-out with pixels to spare", () => {
        const collage = new Collage({ newId: p => `${p}-1` });
        const frame = frameOf(collage, "a4-portrait");
        collage.addImage({
            src: "big.png",
            label: "sneaker",
            natural: { width: 3000, height: 3000 },
            x: frame.x,
            y: frame.y,
            width: frame.width * 0.6,
        });

        const report = checkFrame(collage.layersIn(frame.id), frame, 300);
        expect(report.worst).toBe("good");
        expect(report.summary).toBeNull();
    });

    it("measures screen frames by upscale factor, not dpi", () => {
        const collage = new Collage({ newId: p => `${p}-1` });
        const frame = collage.addFrame({ presetId: "og-1200x630" });
        collage.addImage({
            src: "tiny.png",
            label: "logo",
            natural: { width: 80, height: 80 },
            x: frame.x,
            y: frame.y,
            width: frame.width,
        });

        const report = checkFrame(collage.layersIn(frame.id), frame);
        expect(report.layers[0].effectiveDpi).toBeNull();
        expect(report.layers[0].verdict).toBe("poor");
    });
});

describe("alpha analysis", () => {
    /** A `width`×`height` bitmap with an opaque rectangle inside it. */
    function bitmap(width: number, height: number, opaque: { x: number; y: number; w: number; h: number }) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = opaque.y; y < opaque.y + opaque.h; y++) {
            for (let x = opaque.x; x < opaque.x + opaque.w; x++) {
                const i = (y * width + x) * 4;
                data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255;
            }
        }
        return { data, width, height };
    }

    it("finds the visible shape inside a mostly empty cut-out", () => {
        const crop = alphaBounds(bitmap(100, 100, { x: 40, y: 20, w: 20, h: 60 }));
        // One pixel of margin each side, because the analysis runs on a thumbnail.
        expect(crop.x).toBeCloseTo(0.39, 2);
        expect(crop.width).toBeCloseTo(0.22, 2);
        expect(crop.height).toBeCloseTo(0.62, 2);
    });

    it("returns the full rect for an opaque image", () => {
        const crop = alphaBounds(bitmap(50, 50, { x: 0, y: 0, w: 50, h: 50 }));
        expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    });

    it("does not collapse when an image is entirely transparent", () => {
        const crop = alphaBounds({ data: new Uint8ClampedArray(40 * 40 * 4), width: 40, height: 40 });
        expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    });

    it("reports coverage, which is how a cut-out is told from a photo", () => {
        expect(alphaCoverage(bitmap(100, 100, { x: 0, y: 0, w: 100, h: 100 }))).toBe(1);
        expect(alphaCoverage(bitmap(100, 100, { x: 0, y: 0, w: 50, h: 50 }))).toBeCloseTo(0.25, 5);
    });

    it("picks out the dominant colour", () => {
        expect(dominantColors(bitmap(20, 20, { x: 0, y: 0, w: 20, h: 20 }), 1)).toEqual(["#C82828"]);
    });
});
