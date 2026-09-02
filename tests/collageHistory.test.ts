import { describe, it, expect } from "vitest";
import { Collage } from "../src/lib/collage/model.js";
import { createStudio, FREE_PAGE } from "../src/lib/collage/studio.js";

/**
 * Undo is snapshot-based, and the interesting part is not restoring state — it
 * is deciding what counts as one step. A drag calls update() on every pointer
 * move; if each were its own entry, undo would crawl back through hundreds of
 * intermediate positions instead of putting the layer where it started.
 */

/** A clock we control, so the coalescing window can be tested rather than waited on. */
function clocked() {
    let time = 0;
    let n = 0;
    const collage = new Collage({ newId: p => `${p}-${++n}`, now: () => time });
    return { collage, tick: (ms: number) => (time += ms) };
}

function withImage(collage: Collage) {
    return collage.addImage({
        src: "x", natural: { width: 400, height: 400 }, x: 0, y: 0, width: 100,
    });
}

describe("undo", () => {
    it("treats a whole drag as one step", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        // A drag: many updates in quick succession, all the same kind of change.
        for (let i = 1; i <= 40; i++) collage.update(layer.id, { x: i, y: i });

        expect(collage.get(layer.id)!.x).toBe(40);
        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);
    });

    it("separates edits of different kinds", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        collage.update(layer.id, { x: 200 });
        collage.update(layer.id, { rotation: 30 });

        // Rotation undoes on its own, leaving the move in place.
        collage.undo();
        expect(collage.get(layer.id)!.rotation).toBe(0);
        expect(collage.get(layer.id)!.x).toBe(200);
    });

    it("separates edits that are far enough apart in time", () => {
        const { collage, tick } = clocked();
        const layer = withImage(collage);
        collage.update(layer.id, { x: 50 });
        tick(5000);
        collage.update(layer.id, { x: 90 });

        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(50);
    });

    it("brings back a deleted layer, whoever deleted it", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        collage.remove(layer.id);
        expect(collage.list()).toHaveLength(0);

        collage.undo();
        expect(collage.get(layer.id)).toBeTruthy();
    });

    it("takes back an added layer", () => {
        const { collage } = clocked();
        withImage(collage);
        expect(collage.list()).toHaveLength(1);
        collage.undo();
        expect(collage.list()).toHaveLength(0);
    });

    it("redoes, and a fresh edit abandons the redo branch", () => {
        const { collage, tick } = clocked();
        const layer = withImage(collage);
        collage.update(layer.id, { x: 300 });
        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);

        expect(collage.redo()).toBe(true);
        expect(collage.get(layer.id)!.x).toBe(300);

        collage.undo();
        tick(5000);
        collage.update(layer.id, { rotation: 10 });
        expect(collage.canRedo).toBe(false);
    });

    it("reports having nothing to undo rather than throwing", () => {
        const { collage } = clocked();
        expect(collage.canUndo).toBe(false);
        expect(collage.undo()).toBe(false);
        expect(collage.redo()).toBe(false);
    });

    it("does not let an undo be undone into the edit it reversed", () => {
        // After stepping back, the next edit has to start its own entry rather
        // than coalescing into the one just reversed.
        const { collage } = clocked();
        const layer = withImage(collage);
        collage.update(layer.id, { x: 120 });
        collage.undo();
        collage.update(layer.id, { x: 45 });
        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);
    });

    it("forgets its history when a saved session is loaded", () => {
        // Undoing past a restore would step into the previous session's canvas.
        const { collage } = clocked();
        withImage(collage);
        collage.restore([], []);
        expect(collage.canUndo).toBe(false);
    });
});

describe("arranging does not shrink things", () => {
    function studioOf(count: number) {
        const studio = createStudio();
        for (let i = 0; i < count; i++) {
            studio.collage.addImage({
                src: `${i}`, natural: { width: 800, height: 600 }, x: i * 40, y: 0, width: 200,
            });
        }
        return studio;
    }

    it("settles: the same arrange twice changes nothing the second time", () => {
        // The collage layout packs items against each other, so it does set
        // sizes — it has to. What it must not do is set a *different* size
        // every time, which is how the collage used to melt a little per pass.
        const studio = studioOf(6);
        const page = studio.setPage(FREE_PAGE);

        studio.arrange(page.id, "collage", { seed: 1 });
        const settled = studio.collage.list().map(l => Math.round(l.width));
        for (let pass = 0; pass < 4; pass++) studio.arrange(page.id, "collage", { seed: 1 });

        expect(studio.collage.list().map(l => Math.round(l.width))).toEqual(settled);
    });

    it("does not trend downward across different arrangements", () => {
        // A fresh seed is a genuinely different picture, so sizes move — but
        // they must move around a stable point, not walk towards zero.
        const studio = studioOf(6);
        const page = studio.setPage(FREE_PAGE);
        const area = () => studio.collage.list().reduce((sum, l) => sum + l.width * l.height, 0);

        studio.arrange(page.id, "collage", { seed: 0 });
        const first = area();
        for (let pass = 1; pass < 8; pass++) studio.arrange(page.id, "collage", { seed: pass });

        expect(area()).toBeGreaterThan(first * 0.75);
        expect(area()).toBeLessThan(first * 1.35);
    });

    it("settles on a chosen paper size too, where it does resize", () => {
        // A4 is the case the free canvas cannot cover: here the layout really
        // does set sizes, to fill the sheet. It still has to land on the same
        // ones the second time.
        const studio = studioOf(8);
        const page = studio.setPage("a4-portrait");

        studio.arrange(page.id, "collage", { seed: 2 });
        const settled = studio.collage.list().map(l => Math.round(l.width));
        for (let pass = 0; pass < 4; pass++) studio.arrange(page.id, "collage", { seed: 2 });

        expect(studio.collage.list().map(l => Math.round(l.width))).toEqual(settled);
    });

    it("leaves sizes alone in the layouts that only move things", () => {
        const studio = studioOf(6);
        const page = studio.setPage(FREE_PAGE);
        const before = studio.collage.list().map(l => Math.round(l.width));

        for (let pass = 0; pass < 5; pass++) studio.arrange(page.id, "grid", { seed: pass });

        expect(studio.collage.list().map(l => Math.round(l.width))).toEqual(before);
    });

    it("still moves them", () => {
        const studio = createStudio();
        for (let i = 0; i < 4; i++) {
            studio.collage.addImage({ src: `${i}`, natural: { width: 400, height: 400 }, x: 0, y: 0, width: 100 });
        }
        const page = studio.setPage(FREE_PAGE);
        const before = studio.collage.list().map(l => `${Math.round(l.x)},${Math.round(l.y)}`);
        studio.arrange(page.id, "grid");
        expect(studio.collage.list().map(l => `${Math.round(l.x)},${Math.round(l.y)}`)).not.toEqual(before);
    });

    it("resizes only when explicitly asked to", () => {
        const studio = createStudio();
        for (let i = 0; i < 4; i++) {
            studio.collage.addImage({ src: `${i}`, natural: { width: 400, height: 400 }, x: 0, y: 0, width: 100 });
        }
        const page = studio.setPage(FREE_PAGE);
        studio.arrange(page.id, "grid", { resize: true });
        expect(studio.collage.list().map(l => Math.round(l.width))).not.toEqual([100, 100, 100, 100]);
    });

    it("tells watchers before it moves anything, so the view can animate it", () => {
        const studio = createStudio();
        studio.collage.addImage({ src: "a", natural: { width: 100, height: 100 }, width: 60 });
        const page = studio.setPage(FREE_PAGE);

        let announced = 0;
        const stop = studio.onSettle(() => announced++);
        studio.arrange(page.id, "grid");
        expect(announced).toBe(1);

        stop();
        studio.arrange(page.id, "grid");
        expect(announced).toBe(1);
    });
});

describe("a batch is one thing", () => {
    /**
     * Undo works on edits; an agent's batch is one intention made of many.
     * "Spread the heroes out" should come back in one step rather than being
     * unpicked move by move.
     */
    it("undoes twenty moves in one step", () => {
        const { collage } = clocked();
        const layers = [withImage(collage), withImage(collage), withImage(collage)];
        const before = layers.map(l => collage.get(l.id)!.x);

        collage.batch(() => {
            for (const [i, layer] of layers.entries()) {
                collage.update(layer.id, { x: 500 + i * 10 });
                collage.update(layer.id, { rotation: 12 });
                collage.update(layer.id, { width: 250 });
            }
        });

        collage.undo();
        expect(layers.map(l => collage.get(l.id)!.x)).toEqual(before);
        expect(layers.every(l => collage.get(l.id)!.rotation === 0)).toBe(true);
    });

    it("waits for an async batch to finish before closing it", async () => {
        // An async body returns its promise at the first await, so a plain
        // try/finally would group the synchronous prefix and nothing else.
        const { collage } = clocked();
        const layer = withImage(collage);

        await collage.batch(async () => {
            collage.update(layer.id, { x: 100 });
            await Promise.resolve();
            collage.update(layer.id, { y: 200 });
            await Promise.resolve();
            collage.update(layer.id, { rotation: 45 });
        });

        collage.undo();
        const back = collage.get(layer.id)!;
        expect([back.x, back.y, back.rotation]).toEqual([0, 0, 0]);
    });

    it("closes the group when a batch throws, so half of one is still undoable", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        expect(() => collage.batch(() => {
            collage.update(layer.id, { x: 300 });
            throw new Error("step three failed");
        })).toThrow();

        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);
        // And the next edit starts its own step rather than joining the dead one.
        collage.update(layer.id, { x: 42 });
        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);
    });

    it("keeps a nested batch inside the outer one", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        collage.batch(() => {
            collage.update(layer.id, { x: 10 });
            collage.batch(() => collage.update(layer.id, { y: 20 }));
            collage.update(layer.id, { rotation: 5 });
        });
        collage.undo();
        const back = collage.get(layer.id)!;
        expect([back.x, back.y, back.rotation]).toEqual([0, 0, 0]);
    });

    it("does not swallow an edit made after the batch", () => {
        const { collage } = clocked();
        const layer = withImage(collage);
        collage.batch(() => collage.update(layer.id, { x: 100 }));
        collage.update(layer.id, { x: 200 });

        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(100);
        collage.undo();
        expect(collage.get(layer.id)!.x).toBe(0);
    });
});
