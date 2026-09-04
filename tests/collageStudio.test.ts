import { describe, it, expect, vi } from "vitest";
import { createStudio, FREE_PAGE } from "../src/lib/collage/studio.js";

/**
 * The real studio, not a stand-in.
 *
 * Everything exercised here — arranging, the page, the event log — is plain
 * arithmetic and bookkeeping with no browser in it, so it can be tested
 * directly. That matters: the tool tests run against a fake studio, and a fake
 * will happily agree with whatever the tests expect. These do not.
 */

function studioWith(count: number, at: { x: number; y: number }) {
    const studio = createStudio();
    for (let i = 0; i < count; i++) {
        studio.collage.addImage({
            src: `image-${i}`,
            label: `image ${i}`,
            natural: { width: 400, height: 400 },
            x: at.x + i * 300,
            y: at.y,
            width: 200,
        });
    }
    return studio;
}

describe("arranging", () => {
    it("lays out even when the page is nowhere near the pictures", () => {
        // How this happens in practice: the page is set while the canvas is
        // still empty, so it takes a default rect; the photos are then dropped
        // somewhere else. Membership is by overlap, so the page honestly
        // contains nothing — and arrange used to return 0 and do it silently.
        const studio = studioWith(4, { x: 3000, y: 2000 });
        const page = studio.setPage(FREE_PAGE);
        studio.collage.updateFrame(page.id, { x: -400, y: -300, width: 800, height: 600 });
        expect(studio.collage.layersIn(page.id)).toHaveLength(0);

        expect(studio.arrange(page.id, "grid")).toBe(4);
    });

    it("brings the pictures onto a fixed page rather than leaving them behind", () => {
        const studio = studioWith(5, { x: 4000, y: 4000 });
        const page = studio.setPage("a4-portrait");
        // The page centres on the contents, so move it away deliberately.
        studio.collage.updateFrame(page.id, { x: 0, y: 0 });

        expect(studio.arrange(page.id, "grid")).toBe(5);
        const fresh = studio.collage.getFrame(page.id)!;
        for (const layer of studio.collage.list()) {
            expect(layer.x).toBeGreaterThanOrEqual(fresh.x - 1);
            expect(layer.x + layer.width).toBeLessThanOrEqual(fresh.x + fresh.width + 1);
            expect(layer.y).toBeGreaterThanOrEqual(fresh.y - 1);
            expect(layer.y + layer.height).toBeLessThanOrEqual(fresh.y + fresh.height + 1);
        }
    });

    it("keeps a free page wrapped around the work after it moves", () => {
        const studio = studioWith(6, { x: 0, y: 0 });
        const page = studio.setPage(FREE_PAGE);
        studio.arrange(page.id, "collage", { seed: 4 });

        const fitted = studio.collage.getFrame(page.id)!;
        const contents = studio.collage.contentBounds()!;
        expect(fitted.x).toBeLessThanOrEqual(contents.x + 1);
        expect(fitted.x + fitted.width).toBeGreaterThanOrEqual(contents.x + contents.width - 1);
    });

    it("respects an explicit selection instead of grabbing everything", () => {
        const studio = studioWith(5, { x: 0, y: 0 });
        const page = studio.setPage(FREE_PAGE);
        const chosen = studio.collage.list().slice(0, 2).map(l => l.id);
        const untouched = studio.collage.get(studio.collage.list()[4].id)!;
        const before = { x: untouched.x, y: untouched.y };

        expect(studio.arrange(page.id, "row", { ids: chosen })).toBe(2);
        const after = studio.collage.get(untouched.id)!;
        expect({ x: after.x, y: after.y }).toEqual(before);
    });
});

describe("the page", () => {
    it("only ever has one, however many times it is set", () => {
        const studio = studioWith(2, { x: 0, y: 0 });
        studio.setPage("a4-portrait");
        studio.setPage("og-1200x630");
        studio.setPage(FREE_PAGE);
        expect(studio.collage.listFrames()).toHaveLength(1);
        expect(studio.pagePreset).toBe(FREE_PAGE);
    });

    it("centres a fixed page on the work rather than on the origin", () => {
        const studio = studioWith(3, { x: 5000, y: 5000 });
        const contents = studio.collage.contentBounds()!;
        const page = studio.setPage("a4-portrait");
        expect(page.x + page.width / 2).toBeCloseTo(contents.x + contents.width / 2, 3);
        expect(page.y + page.height / 2).toBeCloseTo(contents.y + contents.height / 2, 3);
    });

    it("gives a free page a real size even with nothing on the canvas", () => {
        const page = createStudio().setPage(FREE_PAGE);
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
    });
});

describe("selection", () => {
    it("drops ids that no longer exist rather than carrying ghosts", () => {
        const studio = studioWith(3, { x: 0, y: 0 });
        const ids = studio.collage.list().map(l => l.id);
        studio.setSelection(ids);
        studio.collage.remove(ids[1]);
        // Re-setting is what prunes; a capture of a deleted layer is nonsense.
        studio.setSelection(studio.selection);
        expect(studio.selection).toEqual([ids[0], ids[2]]);
    });

    it("de-duplicates, so shift-clicking twice does not double an entry", () => {
        const studio = studioWith(2, { x: 0, y: 0 });
        const [a] = studio.collage.list().map(l => l.id);
        studio.setSelection([a, a, a]);
        expect(studio.selection).toEqual([a]);
    });

    it("only tells watchers when it actually changed", () => {
        const studio = studioWith(2, { x: 0, y: 0 });
        const ids = studio.collage.list().map(l => l.id);
        let changes = 0;
        studio.onSelectionChanged(() => changes++);
        studio.setSelection([ids[0]]);
        studio.setSelection([ids[0]]);
        expect(changes).toBe(1);
    });

    it("measures the bounds of what is picked, which is what a capture takes", () => {
        const studio = studioWith(3, { x: 0, y: 0 });
        const ids = studio.collage.list().map(l => l.id);
        studio.setSelection([ids[0], ids[1]]);
        const two = studio.selectionBounds()!;
        studio.setSelection(ids);
        const three = studio.selectionBounds()!;
        expect(three.width).toBeGreaterThan(two.width);

        // Nothing picked, nothing to measure. An empty array means "whatever is
        // selected", the same as passing nothing — matching capture().
        studio.setSelection([]);
        expect(studio.selectionBounds()).toBeNull();
        expect(studio.selectionBounds([])).toBeNull();
    });
});

describe("the event log", () => {
    it("resolves a waiter the moment something happens", async () => {
        const studio = createStudio();
        const waiting = studio.waitForEvents(0, 2000);
        studio.record("layer-moved", "A person moved the cactus.", "human");

        const events = await waiting;
        expect(events).toHaveLength(1);
        expect(events[0].summary).toContain("cactus");
        expect(events[0].by).toBe("human");
    });

    it("returns empty on timeout rather than hanging forever", async () => {
        const studio = createStudio();
        expect(await studio.waitForEvents(0, 20)).toEqual([]);
    });

    it("comes back at once when the caller gives up", async () => {
        const studio = createStudio();
        const controller = new AbortController();
        const waiting = studio.waitForEvents(0, 10_000, controller.signal);
        controller.abort();
        expect(await waiting).toEqual([]);
    });

    it("misses nothing between calls, which is what the cursor is for", async () => {
        const studio = createStudio();
        studio.record("image-added", "one");
        const first = studio.eventsSince(0);
        // Two more land while nobody is listening.
        studio.record("image-added", "two");
        studio.record("image-added", "three");
        const next = await studio.waitForEvents(first.at(-1)!.seq, 50);
        expect(next.map(e => e.summary)).toEqual(["two", "three"]);
    });

    it("records arranging, so a watching agent sees what a person did", () => {
        const studio = studioWith(3, { x: 0, y: 0 });
        const page = studio.setPage(FREE_PAGE);
        studio.arrange(page.id, "grid");
        const kinds = studio.eventsSince(0).map(e => e.kind);
        expect(kinds).toContain("page-changed");
        expect(kinds).toContain("arranged");
    });
});

describe("the show", () => {
    /** Three scenes, one line each, and a record of which one played. */
    function showOf(perform: () => Promise<void>) {
        const studio = createStudio();
        const a = studio.collage.addImage({
            src: "a", label: "a", natural: { width: 100, height: 100 },
            x: 0, y: 0, width: 100,
        });
        const stages = ["one", "two", "three"].map((name, index) => studio.collage.addStage({
            name,
            cast: [{ id: a.id, x: index * 200, y: 0 }],
            script: [{ id: a.id, do: "wave", say: name }],
        }));
        const seen: string[] = [];
        studio.onShowChanged(() => {
            const now = studio.showing;
            if (now && seen.at(-1) !== now) seen.push(now);
        });
        studio.setPerformer(perform);
        return { studio, stages, seen };
    }

    /** A show is minutes of waiting, so it is watched on a clock we can wind. */
    async function watch(studio: ReturnType<typeof createStudio>, hold?: boolean) {
        vi.useFakeTimers();
        try {
            const { duration } = await studio.playShow(undefined, hold ? { hold } : undefined);
            await vi.advanceTimersByTimeAsync(duration + 120_000);
        } finally {
            vi.useRealTimers();
        }
    }

    it("plays every scene without being asked to continue", async () => {
        const { studio, stages, seen } = showOf(async () => {});
        await watch(studio);
        expect(seen).toEqual(stages.map(stage => stage.id));
        expect(studio.showing).toBe(null);
    });

    it("goes on when a scene never finishes, rather than stopping the play", async () => {
        // What this is here for: a voice the browser never starts leaves the
        // scene waiting forever, and the show waited with it — the play ended
        // on chapter one with the lights still down and nothing said about it.
        const { studio, stages, seen } = showOf(() => new Promise<void>(() => {}));
        await watch(studio);
        expect(seen).toEqual(stages.map(stage => stage.id));
        expect(studio.showing).toBe(null);
    });

    it("holds after the last scene only when it was asked to", async () => {
        const { studio, seen } = showOf(async () => {});
        await watch(studio, true);
        expect(seen).toHaveLength(3);
        expect(studio.holding).toBe(true);
    });
});

describe("where a chapter opens", () => {
    /** Two chapters, one walker, and the world as it stands before any of it. */
    function play() {
        const studio = createStudio();
        const wolf = studio.collage.addImage({
            src: "wolf", label: "wolf", natural: { width: 100, height: 100 },
            x: 1200, y: 40, width: 100,
        });
        const one = studio.collage.addStage({
            name: "the road",
            cast: [{ id: wolf.id, x: 1200, y: 40 }],
            script: [{ id: wolf.id, do: "walk", to: { x: 600 } }],
        });
        const two = studio.collage.addStage({
            name: "the door",
            cast: [{ id: wolf.id, x: 1200, y: 40 }],
            script: [],
        });
        return { studio, wolf, one, two };
    }

    it("says where the earlier chapters will have left everybody", () => {
        const { studio, wolf, one, two } = play();
        // Chapter one has not been played, so the document still says 1200 —
        // and blocking chapter two against 1200 is 600 units of wrong.
        expect(studio.collage.get(wolf.id)!.x).toBe(1200);
        expect(studio.openingPositions(one.id).get(wolf.id)).toEqual({ x: 1200, y: 40 });
        expect(studio.openingPositions(two.id).get(wolf.id)).toEqual({ x: 1800, y: 40 });
    });

    it("counts an aimed walk as the walk it turns into", () => {
        const { studio, wolf, one, two } = play();
        studio.collage.updateStage(one.id, {
            script: [{ id: wolf.id, do: "walk", at: { x: 400 } }],
        });
        expect(studio.openingPositions(two.id).get(wolf.id)).toEqual({ x: 400, y: 40 });
    });

    it("does not count an entrance, which walks on to where it was cast", () => {
        // The arrival is put off stage and walks the same distance back, so a
        // chapter of nothing but entrances leaves the world where it found it.
        const { studio, wolf, one, two } = play();
        studio.collage.updateStage(one.id, {
            cast: [{ id: wolf.id, x: 1200, y: 40, entrance: "left" }],
            script: [],
        });
        expect(studio.openingPositions(two.id).get(wolf.id)).toEqual({ x: 1200, y: 40 });
    });
});
