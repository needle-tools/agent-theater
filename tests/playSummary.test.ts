import { describe, it, expect } from "vitest";
import { chaptersOf, secondsOf, summarize, themesOf } from "../src/lib/collage/playSummary.js";
import type { StoredDoc } from "../src/lib/collage/persistence.js";

/**
 * What separates a play from a canvas somebody saved.
 *
 * The library stores whole documents and the save path does not care whether
 * anybody scripted anything, so the summary is what stops an agent being
 * offered a pile of abandoned stages to load.
 */

const doc = (over: Partial<StoredDoc> = {}): StoredDoc => ({
    version: 1, savedAt: 0, layers: [], frames: [], ...over,
} as StoredDoc);

const stage = (over: Record<string, unknown> = {}) => ({
    id: "s", name: "a scene", backdrop: null, cast: [], script: [], ...over,
}) as never;

describe("counting chapters", () => {
    it("calls a document with no stages at all a canvas, not a play", () => {
        expect(chaptersOf(doc())).toBe(0);
        expect(chaptersOf(doc({ stages: [] }))).toBe(0);
    });

    it("does not count a stage nobody ever put anything on", () => {
        // The leftover of a scene started and abandoned — the exact thing
        // the default filter exists to keep out of the library.
        expect(chaptersOf(doc({ stages: [stage()] }))).toBe(0);
    });

    it("counts a tableau: cast and no script is still something to look at", () => {
        expect(chaptersOf(doc({ stages: [stage({ cast: [{ id: "a" }] })] }))).toBe(1);
    });

    it("counts a scripted chapter even with nobody placed on it", () => {
        expect(chaptersOf(doc({ stages: [stage({ script: [{ id: "a", do: "walk" }] })] }))).toBe(1);
    });

    it("counts only the inhabited ones out of a mixed set", () => {
        expect(chaptersOf(doc({
            stages: [stage(), stage({ cast: [{ id: "a" }] }), stage(), stage({ script: [{ id: "b", do: "jump" }] })],
        }))).toBe(2);
    });
});

describe("measuring length", () => {
    it("is zero for a document with nothing to perform", () => {
        expect(secondsOf(doc())).toBe(0);
    });

    it("grows with the script, so a longer play reports longer", () => {
        const short = secondsOf(doc({ stages: [stage({ script: [{ id: "a", do: "walk" }] })] }));
        const long = secondsOf(doc({
            stages: [stage({ script: [{ id: "a", do: "walk" }, { id: "b", do: "jump" }, { id: "c", do: "walk" }] })],
        }));
        expect(short).toBeGreaterThan(0);
        expect(long).toBeGreaterThan(short);
    });

    it("counts the hold, because a chapter that waits is a chapter that runs", () => {
        const held = secondsOf(doc({ stages: [stage({ cast: [{ id: "a" }], hold: 5 })] }));
        expect(held).toBe(5);
    });

    it("adds its chapters up rather than reporting the longest", () => {
        const one = stage({ cast: [{ id: "a" }], hold: 3 });
        expect(secondsOf(doc({ stages: [one, one] }))).toBe(6);
    });

    it("survives a script the planner cannot make sense of", () => {
        // A save is not the place to discover a malformed beat: the chapter
        // still counts, it just measures as nothing.
        const wild = doc({ stages: [stage({ script: [{ nonsense: true } as never] })] });
        expect(() => secondsOf(wild)).not.toThrow();
    });
});

describe("naming themes", () => {
    it("reads the pack out of the troupe path", () => {
        expect(themesOf(doc({
            layers: [
                { kind: "image", src: "/troupe/fairy-tale/king.webp" },
                { kind: "image", src: "/troupe/ocean/kelp.webp" },
            ] as never,
        }))).toEqual(["fairy-tale", "ocean"]);
    });

    it("says each pack once, however many pieces came from it", () => {
        expect(themesOf(doc({
            layers: [
                { kind: "image", src: "/troupe/forest/tree-oak.webp" },
                { kind: "image", src: "/troupe/forest/fern.webp" },
            ] as never,
        }))).toEqual(["forest"]);
    });

    it("claims no theme for art that came from somewhere else", () => {
        // Conjured and uploaded layers have no pack, and inventing one for
        // them would make the filter lie.
        expect(themesOf(doc({
            layers: [{ kind: "image", src: "data:image/webp;base64,AAAA" }, { kind: "image" }] as never,
        }))).toEqual([]);
    });
});

describe("the summary as a whole", () => {
    it("describes a real play in the three numbers the library filters on", () => {
        const summary = summarize(doc({
            layers: [{ kind: "image", src: "/troupe/villains/witch.webp" }] as never,
            stages: [stage({ cast: [{ id: "a" }], script: [{ id: "a", do: "walk" }], hold: 2 })],
        }));
        expect(summary.chapters).toBe(1);
        expect(summary.seconds).toBeGreaterThan(2);
        expect(summary.themes).toEqual(["villains"]);
    });

    it("marks a saved canvas as having no chapters, which is what hides it", () => {
        expect(summarize(doc({
            layers: [{ kind: "image", src: "/troupe/food/pretzel.webp" }] as never,
        }))).toMatchObject({ chapters: 0, seconds: 0, themes: ["food"] });
    });
});
