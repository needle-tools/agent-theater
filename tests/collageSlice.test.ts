import { describe, it, expect } from "vitest";
import { smallestPiece } from "../src/lib/collage/background.js";
import { Collage } from "../src/lib/collage/model.js";

/**
 * Cutting a photo of several things into several things.
 *
 * The threshold is the whole difficulty. FastCut's own floor is an absolute
 * pixel count, which cannot be right for both a thumbnail and a 12-megapixel
 * photo — on the photo it keeps every fleck of model noise as its own object,
 * and the caller gets forty layers of dust.
 */

describe("what counts as a piece", () => {
    it("scales with the image, rather than being a fixed count", () => {
        const small = smallestPiece(400, 300);
        const large = smallestPiece(4000, 3000);
        expect(large).toBeGreaterThan(small * 50);
    });

    it("is about a fiftieth of the shorter edge across", () => {
        // 2% of 1000 is 20 pixels, so a 20×20 blob is the smallest thing kept.
        expect(Math.sqrt(smallestPiece(1600, 1000))).toBeCloseTo(20, 0);
    });

    it("does not depend on which edge is the short one", () => {
        expect(smallestPiece(1600, 1000)).toBe(smallestPiece(1000, 1600));
    });

    it("keeps a floor, so a tiny image still slices", () => {
        // 2% of 40 pixels is under a pixel, and a threshold of zero would keep
        // every speck; a threshold of "everything" would keep none.
        expect(smallestPiece(40, 30)).toBe(64);
    });

    it("stays well under a whole object at any size", () => {
        // The guard against the threshold eating the very things it is meant to
        // let through: a piece filling a tenth of the frame must always survive.
        for (const [w, h] of [[400, 300], [1200, 900], [4000, 3000], [8000, 6000]]) {
            expect(smallestPiece(w, h)).toBeLessThan((w * h) / 100);
        }
    });
});

describe("placing the pieces where they were", () => {
    /**
     * The composition is information — five stickers arranged on a desk were
     * arranged by someone — so the pieces land as a group in the box the whole
     * photo would have taken.
     */
    function place(source: { width: number; height: number }, boxes: { x: number; y: number; width: number }[]) {
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const width = Math.min(source.width, 420);
        const spot = collage.spotFor({
            x: 0, y: 0, width, height: width * (source.height / source.width),
        });
        return boxes.map(box => ({
            x: spot.x + (box.x / source.width) * spot.width,
            y: spot.y + (box.y / source.height) * spot.height,
            width: (box.width / source.width) * spot.width,
        }));
    }

    it("keeps the pieces in the same arrangement as in the photo", () => {
        const source = { width: 1000, height: 500 };
        const [left, right] = place(source, [
            { x: 100, y: 100, width: 200 },
            { x: 600, y: 100, width: 200 },
        ]);
        // Same order, same gap relative to their size.
        expect(left.x).toBeLessThan(right.x);
        expect((right.x - left.x) / left.width).toBeCloseTo(500 / 200, 5);
        expect(left.y).toBeCloseTo(right.y, 5);
    });

    it("takes one spot for the whole group, not one per piece", () => {
        // Placing each piece on the automatic spiral would scatter a
        // composition that had already been composed.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const first = collage.spotFor({ width: 400, height: 300 });
        const second = collage.spotFor({ width: 400, height: 300 });
        expect(first).not.toEqual(second);

        // ...but an explicit position is honoured exactly, which is what the
        // piece placement relies on.
        const fixed = collage.spotFor({ x: 10, y: 20, width: 400, height: 300 });
        expect(fixed).toEqual({ x: 10, y: 20, width: 400, height: 300 });
    });

    it("scales the group down to the size one photo would have been", () => {
        const source = { width: 2000, height: 1000 };
        const [piece] = place(source, [{ x: 0, y: 0, width: 1000 }]);
        // Half the photo's width, and the photo lands 420 wide.
        expect(piece.width).toBeCloseTo(210, 5);
    });
});

describe("the sticker look", () => {
    it("is on for a newly added image", () => {
        // What makes a cut-out read as a cut-out: without a rim, its edge is
        // wherever the model happened to stop.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const layer = collage.addImage({ src: "a", natural: { width: 400, height: 400 }, width: 200 });
        expect(layer.style.outline?.color).toBe("#FFFFFF");
        expect(layer.style.outline!.width).toBeGreaterThan(0);
        expect(layer.style.shadow).toBeTruthy();
    });

    it("sizes the rim to the layer instead of using one number for everything", () => {
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const small = collage.addImage({ src: "a", natural: { width: 400, height: 400 }, width: 60 });
        const large = collage.addImage({ src: "b", natural: { width: 400, height: 400 }, width: 600 });
        expect(large.style.outline!.width).toBeGreaterThan(small.style.outline!.width);
        // Both still a rim rather than a hairline or a frame.
        expect(small.style.outline!.width).toBeGreaterThanOrEqual(3);
        expect(large.style.outline!.width).toBeLessThanOrEqual(18);
    });

    it("never overrides a style that was asked for", () => {
        // A paste carries the original's style, and restoring one must not
        // restyle it.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const layer = collage.addImage({
            src: "a",
            natural: { width: 400, height: 400 },
            width: 200,
            style: { outline: null, shadow: null, silhouette: null, opacity: 1 },
        });
        expect(layer.style.outline).toBeNull();
        expect(layer.style.shadow).toBeNull();
    });

    it("is off for a piece cut out of a larger picture", () => {
        // The rule: a lone cut-out is a sticker, a piece of a scene is not.
        // Three heroes lifted out of one poster are still standing in the
        // poster's arrangement, and a white rim round each draws a border
        // through the middle of something meant to look continuous.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const piece = collage.addImage({
            src: "hero", natural: { width: 400, height: 900 }, width: 200,
            style: { silhouette: null, outline: null, shadow: null, opacity: 1 },
        });
        expect(piece.style.outline).toBeNull();
        expect(piece.style.shadow).toBeNull();

        // ...while a photo added on its own still gets it.
        const alone = collage.addImage({ src: "sticker", natural: { width: 400, height: 400 }, width: 200 });
        expect(alone.style.outline).toBeTruthy();
    });

    it("leaves text alone", () => {
        // Text has no style block at all, so it cannot pick the sticker look up
        // by accident — worth stating, because a white rim round a headline is
        // exactly the sort of thing a default quietly does to everything.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const layer = collage.addText({ text: "Hello" });
        expect(layer.kind).toBe("text");
        expect("style" in layer).toBe(false);
    });
});
