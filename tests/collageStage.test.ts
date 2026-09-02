import { describe, it, expect } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { castOf, placed } from "../src/lib/collage/stage.js";

/**
 * Scenes.
 *
 * The idea the whole feature rests on: a stage does not own its layers, it
 * records where they stand while it plays. So the same character appears in two
 * scenes at different places without being duplicated, and restyling it changes
 * it in both.
 *
 * The consequence that needs testing hardest is that a document with a stage
 * showing *presents itself as that stage* — because everything downstream, the
 * canvas and dragging and arranging and export, relies on that being true
 * rather than on knowing stages exist.
 */

function canvasWith(count: number) {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const layers: ImageLayer[] = [];
    for (let i = 0; i < count; i++) {
        layers.push(collage.addImage({
            src: `${i}`, label: `sprite ${i}`,
            natural: { width: 400, height: 400 }, x: i * 100, y: 0, width: 200,
        }));
    }
    return { collage, layers };
}

describe("a stage holds placements, not layers", () => {
    it("puts the same layer in two scenes at different places", () => {
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ name: "rooftop", cast: [{ id: hero, x: 10, y: 20 }] });
        const two = collage.addStage({ name: "alley", cast: [{ id: hero, x: 900, y: 400 }] });

        collage.setActiveStage(one.id);
        expect(collage.get(hero)).toMatchObject({ x: 10, y: 20 });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: 900, y: 400 });
    });

    it("shares everything that is not a position", () => {
        // Recolouring a character in one scene recolours it in the other,
        // which is the whole reason not to duplicate it.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        const two = collage.addStage({ cast: [{ id: hero, x: 500, y: 0 }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { style: { silhouette: "#222" } });

        collage.setActiveStage(two.id);
        expect((collage.get(hero) as ImageLayer).style.silhouette).toBe("#222");
        expect(collage.get(hero)!.x).toBe(500);
    });

    it("shows only the cast while a scene is up, and everything otherwise", () => {
        const { collage, layers } = canvasWith(4);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[2].id, x: 50, y: 0 }] });

        expect(collage.list()).toHaveLength(4);
        collage.setActiveStage(stage.id);
        expect(collage.list().map(l => l.id)).toEqual([layers[0].id, layers[2].id]);
        // ...but the others have not gone anywhere.
        expect(collage.listAll()).toHaveLength(4);
        collage.setActiveStage(null);
        expect(collage.list()).toHaveLength(4);
    });

    it("draws the backdrop behind everyone", () => {
        // A scene with its room painted over its people is not a scene.
        const { collage, layers } = canvasWith(3);
        const stage = collage.addStage({
            backdrop: layers[2].id,
            cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[1].id, x: 10, y: 0 }],
        });
        collage.setActiveStage(stage.id);
        expect(collage.list()[0].id).toBe(layers[2].id);
    });

    it("skips a cast member that has been deleted", () => {
        // A deleted layer should vanish from every scene, not leave a hole with
        // a name in it.
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({
            cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[1].id, x: 100, y: 0 }],
        });
        collage.remove(layers[1].id);
        collage.setActiveStage(stage.id);
        expect(collage.list()).toHaveLength(1);
    });

    it("resizes by width, letting height follow the layer's own shape", () => {
        const layer = { width: 200, height: 100 } as ImageLayer;
        expect(placed(layer, { id: "x", x: 0, y: 0, width: 400 }, 0)).toMatchObject({ width: 400, height: 200 });
    });

    it("falls back to the order given when a placement has no z", () => {
        const layers = [
            { id: "a", width: 10, height: 10, z: 99 },
            { id: "b", width: 10, height: 10, z: 1 },
        ] as ImageLayer[];
        const stage = { id: "s", name: "s", backdrop: null, cast: [{ id: "b", x: 0, y: 0 }, { id: "a", x: 0, y: 0 }] };
        const order = castOf(stage, id => layers.find(l => l.id === id) ?? null).map(l => l.id);
        expect(order).toEqual(["b", "a"]);
    });
});

describe("editing while a scene is showing", () => {
    it("moves the character in this scene and no other", () => {
        // The trap this design invites: blocking one scene silently re-blocking
        // every other scene the same character is in.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        const two = collage.addStage({ cast: [{ id: hero, x: 500, y: 0 }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { x: 250, y: 60 });

        expect(collage.get(hero)).toMatchObject({ x: 250, y: 60 });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: 500, y: 0 });
        // And the layer's own position is untouched by either.
        collage.setActiveStage(null);
        expect(collage.get(hero)!.x).toBe(0);
    });

    it("sends a style change to the layer even in the same call as a move", () => {
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const stage = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.update(hero, { x: 40, label: "the hero" });

        expect(collage.get(hero)).toMatchObject({ x: 40, label: "the hero" });
        collage.setActiveStage(null);
        expect(collage.get(hero)).toMatchObject({ x: 0, label: "the hero" });
    });

    it("edits the layer itself for someone who is not in the scene", () => {
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.update(layers[1].id, { x: 777 });
        collage.setActiveStage(null);
        expect(collage.get(layers[1].id)!.x).toBe(777);
    });

    it("keeps a height-only resize, folding it into the width the stage stores", () => {
        // A placement holds one dimension, so an edit that gave only a height
        // would otherwise be dropped without a word.
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        const before = collage.get(layers[0].id)!.height;
        collage.update(layers[0].id, { height: before * 2 });
        expect(collage.get(layers[0].id)!.height).toBeCloseTo(before * 2, 3);
    });
});

describe("scenes and history", () => {
    it("undoes a move made inside a scene", () => {
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);
        collage.update(layers[0].id, { x: 400 });

        collage.undo();
        expect(collage.get(layers[0].id)!.x).toBe(0);
    });

    it("brings a deleted scene back", () => {
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ name: "gone", cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.removeStage(stage.id);
        expect(collage.listStages()).toHaveLength(0);

        collage.undo();
        expect(collage.listStages().map(s => s.name)).toEqual(["gone"]);
    });

    it("stops showing a scene that has been undone out of existence", () => {
        const { collage, layers } = canvasWith(2);
        collage.update(layers[0].id, { x: 5 });
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.undo();
        expect(collage.activeStageId).toBeNull();
        expect(collage.list()).toHaveLength(2);
    });

    it("survives a save and restore", () => {
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({
            name: "rooftop",
            backdrop: layers[1].id,
            cast: [{ id: layers[0].id, x: 33, y: 44, entrance: "left" }],
        });

        const reopened = new Collage({ newId: p => `${p}-x` });
        reopened.restore(collage.listAll(), collage.listFrames(), collage.listStages());

        const back = reopened.getStage(stage.id)!;
        expect(back.name).toBe("rooftop");
        expect(back.backdrop).toBe(layers[1].id);
        expect(back.cast[0]).toMatchObject({ x: 33, y: 44, entrance: "left" });
    });
});
