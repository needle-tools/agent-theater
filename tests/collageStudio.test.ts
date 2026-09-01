import { describe, it, expect } from "vitest";
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
