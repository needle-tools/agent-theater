import { describe, it, expect } from "vitest";
import { Collage } from "../src/lib/collage/model.js";
import { capturedLayers } from "../src/lib/collage/studio.js";

/**
 * What ends up in a capture.
 *
 * The whole point of capture is handing a piece of the collage to something
 * that makes pictures and dropping the answer back in its place. That only
 * works if "this sticker" means the sticker — an image model given the sticker
 * plus everything crowding it answers a different question than the one asked.
 *
 * Drawing needs a canvas, so the decision lives in its own function and this
 * tests that rather than the rasteriser.
 */

function crowdedCanvas() {
    let n = 0;
    const collage = new Collage({ newId: p => `${p}-${++n}` });
    // All four overlap each other's boxes, which is the normal state of a
    // collage — things are meant to touch.
    const person = collage.addImage({ src: "person", label: "person", natural: { width: 400, height: 600 }, x: 100, y: 100, width: 300 });
    const headline = collage.addText({ text: "Company", x: 80, y: 60, width: 400 });
    const plant = collage.addImage({ src: "plant", label: "plant", natural: { width: 200, height: 200 }, x: 320, y: 380, width: 160 });
    const faraway = collage.addImage({ src: "far", label: "far", natural: { width: 100, height: 100 }, x: 4000, y: 4000, width: 100 });
    return { collage, person, headline, plant, faraway };
}

const boundsOf = (collage: Collage, ids: string[]) => collage.contentBounds(ids)!;

describe("capturing layers", () => {
    it("takes the one sticker asked for, not its neighbours", () => {
        const { collage, person } = crowdedCanvas();
        const region = boundsOf(collage, [person.id]);

        const drawn = capturedLayers(collage.list(), region, [person.id], false);

        expect(drawn.map(l => l.id)).toEqual([person.id]);
    });

    it("takes exactly a multi-selection, in canvas order", () => {
        const { collage, person, plant } = crowdedCanvas();
        const ids = [plant.id, person.id];
        const region = boundsOf(collage, ids);

        const drawn = capturedLayers(collage.list(), region, ids, false);

        // Back-to-front, whatever order they were clicked in.
        expect(drawn.map(l => l.id)).toEqual([person.id, plant.id]);
    });

    it("leaves out a layer that is asked for but no longer there", () => {
        const { collage, person, plant } = crowdedCanvas();
        const region = boundsOf(collage, [person.id]);
        collage.remove(plant.id);

        const drawn = capturedLayers(collage.list(), region, [person.id, plant.id], false);

        expect(drawn.map(l => l.id)).toEqual([person.id]);
    });

    it("takes everything in frame when an explicit rectangle is given", () => {
        // A rectangle is a different question: whatever is in it, including
        // things nobody selected.
        const { collage, faraway } = crowdedCanvas();
        const region = { x: 0, y: 0, width: 600, height: 700 };

        const drawn = capturedLayers(collage.list(), region, [], true);

        expect(drawn).toHaveLength(3);
        expect(drawn.map(l => l.id)).not.toContain(faraway.id);
    });

    it("ignores a selection when a rectangle was named", () => {
        const { collage, person } = crowdedCanvas();
        const region = { x: 0, y: 0, width: 600, height: 700 };

        const drawn = capturedLayers(collage.list(), region, [person.id], true);

        expect(drawn.length).toBeGreaterThan(1);
    });

    it("falls back to overlap when nothing was picked", () => {
        // The no-selection case is "capture what I am looking at".
        const { collage } = crowdedCanvas();
        const region = { x: 0, y: 0, width: 600, height: 700 };

        expect(capturedLayers(collage.list(), region, [], false)).toHaveLength(3);
    });
});
