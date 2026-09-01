import { describe, it, expect } from "vitest";
import { profileOf, sampleProfile, shapeFromMask, solidProfile, type Shape } from "../src/lib/collage/silhouette.js";
import { arrange } from "../src/lib/collage/layout.js";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";

/**
 * Packing shapes rather than boxes.
 *
 * The claim being tested is specific: two cut-outs whose *boxes* would collide
 * can still sit side by side, because the parts of the boxes that collide are
 * transparent. If that does not hold, the packer is only pretending to use the
 * silhouettes and everything gets a rectangle of clearance it never needed.
 */

/** A shape from an ASCII picture — '#' is opaque, anything else is not. */
function shapeOf(rows: string[]): Shape {
    const columns = rows[0].length;
    const cells = new Uint8Array(columns * rows.length);
    rows.forEach((row, y) => [...row].forEach((c, x) => {
        cells[y * columns + x] = c === "#" ? 1 : 0;
    }));
    return { columns, rows: rows.length, cells };
}

describe("reading a profile off a shape", () => {
    it("finds where the opaque pixels start and stop in each column", () => {
        const shape = shapeOf([
            "..##..",
            ".####.",
            "######",
            "######",
        ]);
        const profile = profileOf(shape, 0, 1, 6);
        // The middle columns are opaque from the very top; the outer ones only
        // from halfway down.
        expect(sampleProfile(profile, 0.5).top).toBeLessThan(sampleProfile(profile, 0.05).top);
        for (let i = 0; i < 6; i++) expect(sampleProfile(profile, (i + 0.5) / 6).filled).toBe(true);
    });

    it("marks a column the shape does not reach as empty, not as zero-height", () => {
        // The difference matters: an empty column constrains nothing, so a
        // neighbour may pass straight through it.
        const shape = shapeOf([
            "##....",
            "##....",
            "##....",
            "##....",
        ]);
        const profile = profileOf(shape, 0, 1, 6);
        expect(sampleProfile(profile, 0.1).filled).toBe(true);
        expect(sampleProfile(profile, 0.9).filled).toBe(false);
    });

    it("falls back to the whole box when there is no shape", () => {
        const profile = profileOf(null, 0, 1, 8);
        expect(sampleProfile(profile, 0.5)).toEqual({ top: 0, bottom: 1, filled: true });
    });

    it("falls back to the whole box for a mask with nothing in it", () => {
        // A fully transparent cut-out must still take up room; vanishing from
        // the packing would drop it on top of whatever is placed next.
        const profile = profileOf(shapeOf(["....", "....", "....", "...."]), 0, 1, 8);
        expect(sampleProfile(profile, 0.5).filled).toBe(true);
        expect(solidProfile(8).bottom[0]).toBe(1);
    });

    it("turns with the shape", () => {
        // A tall bar on its side is a wide bar: after a quarter turn the outer
        // columns are opaque where before they were empty.
        const bar = shapeOf([
            "..##..",
            "..##..",
            "..##..",
            "..##..",
        ]);
        expect(sampleProfile(profileOf(bar, 0, 1, 8), 0.06).filled).toBe(false);
        expect(sampleProfile(profileOf(bar, 90, 1, 8), 0.06).filled).toBe(true);
    });
});

describe("reading a shape off a mask", () => {
    const mask = {
        width: 4,
        height: 4,
        data: new Uint8Array([
            1, 1, 0, 0,
            1, 1, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
        ]),
    };

    it("covers the whole image when nothing is cropped", () => {
        const shape = shapeFromMask(mask, { x: 0, y: 0, width: 1, height: 1 }, 4);
        expect([...shape.cells.slice(0, 4)]).toEqual([1, 1, 0, 0]);
    });

    it("follows the crop, because that is what the layer actually shows", () => {
        // The top-left quarter is entirely opaque, so a layer cropped to it has
        // no silhouette to nest into and should pack as a plain box.
        const shape = shapeFromMask(mask, { x: 0, y: 0, width: 0.5, height: 0.5 }, 4);
        expect([...shape.cells].every(c => c === 1)).toBe(true);
    });
});

describe("packing with silhouettes", () => {
    function layersOf(count: number) {
        let n = 0;
        const collage = new Collage({ newId: p => `${p}-${++n}` });
        const layers: ImageLayer[] = [];
        for (let i = 0; i < count; i++) {
            layers.push(collage.addImage({
                src: `${i}`, natural: { width: 400, height: 400 }, width: 200,
            }));
        }
        return layers;
    }

    const area = { x: 0, y: 0, width: 1000, height: 1000 };
    const blockHeight = (placements: { y: number; height: number }[]) =>
        Math.max(...placements.map(p => p.y + p.height)) - Math.min(...placements.map(p => p.y));

    it("packs shapes into less room than it packs their boxes", () => {
        // Each cut-out only fills the left half of its box, so half of every
        // box is air. Using the silhouettes, that air is available to the
        // neighbours; ignoring them, it is reserved for nothing.
        const layers = layersOf(12);
        const half = shapeOf([
            "##....", "##....", "##....",
            "##....", "##....", "##....",
        ]);
        const shapes = new Map(layers.map(l => [l.id, half]));

        // fill:false so the total artwork is held constant and the only
        // thing that can change is how tightly it packs. Filling the page
        // instead just grows everything to the page and hides the difference.
        const asBoxes = arrange(layers, area, "collage", { seed: 3, jitter: 0, fill: false });
        const asShapes = arrange(layers, area, "collage", { seed: 3, jitter: 0, fill: false, shapes });

        expect(blockHeight(asShapes)).toBeLessThan(blockHeight(asBoxes) * 0.85);
    });

    it("lets a bump settle into a notch", () => {
        // A puzzle piece: hollow in the middle at the top, and a stub sticking
        // out of the middle at the bottom. One of these leaves a frontier the
        // next one can sink into, which no rectangle packer can see.
        //
        // Two of the same U would NOT nest, and that is not a failing — a U
        // presents a flat underside, so there is nothing to rise into the
        // hollow above it.
        const layers = layersOf(9);
        const piece = shapeOf([
            "##..##", "##..##",
            "######", "######",
            "..##..", "..##..",
        ]);
        const shapes = new Map(layers.map(l => [l.id, piece]));

        const asBoxes = arrange(layers, area, "collage", { seed: 4, jitter: 0, fill: false });
        const asShapes = arrange(layers, area, "collage", { seed: 4, jitter: 0, fill: false, shapes });

        expect(blockHeight(asShapes)).toBeLessThan(blockHeight(asBoxes));
    });

    it("changes nothing for shapes that fill their boxes", () => {
        // The guard against the packer quietly nesting things that have no
        // transparency to nest into.
        const layers = layersOf(8);
        const solid = shapeOf(["####", "####", "####", "####"]);
        const shapes = new Map(layers.map(l => [l.id, solid]));

        // Upright, because a tilted square's swept box genuinely has empty
        // corners -- the profile is right to nest into those, so it would not
        // match the box packing and should not.
        const withShapes = arrange(layers, area, "collage", { seed: 5, jitter: 0, shapes });
        const without = arrange(layers, area, "collage", { seed: 5, jitter: 0 });

        for (const [i, p] of withShapes.entries()) {
            expect(p.x).toBeCloseTo(without[i].x, 4);
            expect(p.y).toBeCloseTo(without[i].y, 4);
        }
    });

    it("still places a layer whose shape is missing", () => {
        // Text, and any image whose pixels could not be read.
        const layers = layersOf(6);
        const shapes = new Map([[layers[0].id, shapeOf(["##..", "##..", "##..", "##.."])]]);
        const placements = arrange(layers, area, "collage", { seed: 6, shapes });
        expect(placements).toHaveLength(6);
        expect(placements.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    });
});
