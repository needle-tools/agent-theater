import { describe, it, expect } from "vitest";
import {
    Collage, bounds, outputSize, placementIn, presetCanvasSize, findPreset,
    type Frame, type ImageLayer,
} from "../src/lib/collage/model.js";
import { arrange, placementBounds, type Placement } from "../src/lib/collage/layout.js";

/** Do any two placements share a pixel? */
function overlapping(placements: Placement[]): boolean {
    return placements.some((a, i) => placements.slice(i + 1).some(b =>
        a.x < b.x + b.width - 0.01 && a.x + a.width - 0.01 > b.x
        && a.y < b.y + b.height - 0.01 && a.y + a.height - 0.01 > b.y));
}
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

    it("scales the type when a text layer is resized", () => {
        // Widening the box alone changes nothing you can see, which is what
        // made the resize handle look broken on text.
        const collage = new Collage();
        const text = collage.addText({ text: "Summer", fontSize: 40 });
        const wider = collage.update(text.id, { width: text.width * 2 }) as typeof text;
        expect(wider.fontSize).toBeCloseTo(80, 3);
        expect(wider.height).toBeCloseTo(80 * 1.25, 3);

        const smaller = collage.update(text.id, { width: wider.width / 4 }) as typeof text;
        expect(smaller.fontSize).toBeCloseTo(20, 3);
    });

    it("fits a text box to its content without touching the type size", () => {
        // What a finished edit needs: the box hugs the new words, but the
        // letters stay the size they were.
        const collage = new Collage();
        const text = collage.addText({ text: "Text", fontSize: 64 });
        const fitted = collage.fitText(text.id, 240, 80)!;
        expect(fitted.width).toBe(240);
        expect(fitted.height).toBe(80);
        expect(fitted.fontSize).toBe(64);
    });

    it("stacks new layers in front and can reorder them", () => {
        const { collage, layers } = collageWith(3);
        expect(collage.list().map(l => l.id)).toEqual(layers.map(l => l.id));
        collage.sendToBack(layers[2].id);
        expect(collage.list()[0].id).toBe(layers[2].id);
        collage.bringToFront(layers[0].id);
        expect(collage.list().at(-1)!.id).toBe(layers[0].id);
    });

    it("puts a layer where it was asked for", () => {
        const collage = new Collage();
        // A right-click or a drop names a point; the first thing added lands on
        // it rather than wherever the automatic spiral had got to.
        const text = collage.addText({ text: "Summer", fontSize: 40, near: { x: 900, y: -250 } });
        expect(text.x + text.width / 2).toBeCloseTo(900, 3);
        expect(text.y + 20).toBeCloseTo(-250, 3);

        const image = collage.addImage({
            src: "x", natural: { width: 200, height: 200 }, width: 100, near: { x: -400, y: 600 },
        });
        // Its own point, not pushed along by what came before it.
        expect(image.x + image.width / 2).toBeCloseTo(-400, 3);
        expect(image.y + image.height / 2).toBeCloseTo(600, 3);
    });

    it("fans several out around the point instead of stacking them on it", () => {
        const collage = new Collage();
        const at = { x: 100, y: 100 };
        const placed = Array.from({ length: 4 }, () =>
            collage.addImage({ src: "x", natural: { width: 100, height: 100 }, width: 80, near: at }));
        const spots = new Set(placed.map(l => `${Math.round(l.x)},${Math.round(l.y)}`));
        expect(spots.size).toBe(4);
        // Still gathered around where they were dropped.
        for (const layer of placed) {
            expect(Math.hypot(layer.x + 40 - at.x, layer.y + 40 - at.y)).toBeLessThan(250);
        }
    });

    it("takes x and y from the same point on the spiral", () => {
        // They were read from two separate calls, so each layer got its x from
        // one position and its y from the next — and the spiral advanced twice
        // per layer.
        const collage = new Collage();
        const a = collage.addImage({ src: "a", natural: { width: 100, height: 100 }, width: 100 });
        const b = collage.addImage({ src: "b", natural: { width: 100, height: 100 }, width: 100 });

        const centre = (l: typeof a) => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });
        // Index 0 of the spiral is angle 0 at radius 60: dead on the x axis.
        expect(centre(a).x).toBeCloseTo(60, 3);
        expect(centre(a).y).toBeCloseTo(0, 3);
        // And the second is one step along, not two.
        expect(Math.hypot(centre(b).x, centre(b).y)).toBeCloseTo(60 + 90, 3);
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

    it("keeps tilted layouts inside the area, corners and all", () => {
        // The visible complaint: pictures hanging off the edge of the page. A
        // rotated item's swept box is bigger than the item, and that is what
        // has to fit.
        const { layers } = collageWith(9);
        for (const mode of ["scatter", "collage"] as const) {
            for (const p of arrange(layers, area, mode, { seed: 3 })) {
                const swept = bounds({ ...layers[0], ...p, rotation: p.rotation });
                expect(swept.x).toBeGreaterThanOrEqual(area.x - 2);
                expect(swept.y).toBeGreaterThanOrEqual(area.y - 2);
                expect(swept.x + swept.width).toBeLessThanOrEqual(area.x + area.width + 2);
                expect(swept.y + swept.height).toBeLessThanOrEqual(area.y + area.height + 2);
            }
        }
    });

    it("packs rows without letting one hang off the side", () => {
        // The old version scaled the finished block by height alone, so a wide
        // row could still overflow horizontally.
        const wide = { x: 0, y: 0, width: 500, height: 1400 };
        const { layers } = collageWith(11, { width: 1600, height: 400 });
        for (const p of arrange(layers, wide, "packed")) {
            expect(p.x).toBeGreaterThanOrEqual(wide.x - 1);
            expect(p.x + p.width).toBeLessThanOrEqual(wide.x + wide.width + 1);
            expect(p.y + p.height).toBeLessThanOrEqual(wide.y + wide.height + 1);
        }
    });

    it("spreads scatter evenly instead of clumping in a corner", () => {
        // Uniform random reliably leaves bare quadrants at this count, which
        // reads as a bug. A jittered grid does not.
        const { layers } = collageWith(16);
        const placements = arrange(layers, area, "scatter", { seed: 5 });
        const quadrants = new Set(placements.map(p => {
            const right = p.x + p.width / 2 > area.x + area.width / 2;
            const below = p.y + p.height / 2 > area.y + area.height / 2;
            return `${right}-${below}`;
        }));
        expect(quadrants.size).toBe(4);
    });

    it("never puts one cut-out on top of another", () => {
        // The whole appeal of a plate of cut-outs is seeing all of them. The
        // old collage mode overlapped on purpose and buried half of them.
        const { layers } = collageWith(14);
        const placements = arrange(layers, area, "collage", { seed: 2 });
        expect(overlapping(placements)).toBe(false);
    });

    it("still does not overlap when the shapes are wildly different", () => {
        const wide = collageWith(5, { width: 1600, height: 200 }).layers;
        const tall = collageWith(5, { width: 200, height: 1600 }).layers;
        expect(overlapping(arrange([...wide, ...tall], area, "collage", { seed: 9 }))).toBe(false);
    });

    it("fills the area instead of huddling in the middle", () => {
        const { layers } = collageWith(20);
        const placements = arrange(layers, area, "collage", { seed: 4 });
        const packed = placementBounds(placements)!;
        // Within the page, and using most of it — the old version left the
        // corners bare while piling everything into the centre.
        expect(packed.width).toBeGreaterThan(area.width * 0.7);
        expect(packed.height).toBeGreaterThan(area.height * 0.7);
        expect(packed.width).toBeLessThanOrEqual(area.width + 1);
        expect(packed.height).toBeLessThanOrEqual(area.height + 1);
    });

    it("settles rather than shrinking a little more every pass", () => {
        // The reason arranging used to melt a collage: each pass re-fitted, and
        // scaling by height alone overshoots because area goes as the square.
        const { layers } = collageWith(12);
        const first = arrange(layers, area, "collage", { seed: 3 });
        const grown = layers.map(layer => {
            const p = first.find(q => q.id === layer.id)!;
            return { ...layer, x: p.x, y: p.y, width: p.width, height: p.height };
        });
        const second = arrange(grown, area, "collage", { seed: 3 });

        for (const p of second) {
            const before = first.find(q => q.id === p.id)!;
            expect(p.width / before.width).toBeGreaterThan(0.9);
            expect(p.width / before.width).toBeLessThan(1.1);
        }
    });

    it("tilts things, because a collage that does not is a contact sheet", () => {
        const { layers } = collageWith(12);
        const placements = arrange(layers, area, "collage", { seed: 6 });
        expect(placements.filter(p => Math.abs(p.rotation) > 1).length).toBeGreaterThan(6);
        // Leaning both ways, not all sharing a lean.
        expect(placements.some(p => p.rotation > 1)).toBe(true);
        expect(placements.some(p => p.rotation < -1)).toBe(true);
    });

    it("does not overlap once the tilted corners are counted either", () => {
        // The stronger claim, and the one that matters: packing the upright box
        // would leave the corners of neighbouring tilted items crossing.
        const { layers } = collageWith(14);
        const placements = arrange(layers, area, "collage", { seed: 8 });
        const swept = placements.map(p => bounds({ ...layers[0], ...p, rotation: p.rotation }));
        expect(overlapping(swept.map((s, i) => ({ ...placements[i], ...s })))).toBe(false);
    });

    it("takes the tilt as far as it is told to and no further", () => {
        const { layers } = collageWith(10);
        for (const p of arrange(layers, area, "collage", { seed: 6, jitter: 4 })) {
            expect(Math.abs(p.rotation)).toBeLessThanOrEqual(4);
        }
        for (const p of arrange(layers, area, "collage", { seed: 6, jitter: 0 })) {
            expect(Math.abs(p.rotation)).toBe(0);
        }
    });

    it("does not overlap in packed either", () => {
        expect(overlapping(arrange(collageWith(6).layers, area, "packed"))).toBe(false);
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
