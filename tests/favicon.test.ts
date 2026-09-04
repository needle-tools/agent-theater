import { describe, it, expect } from "vitest";
import { matchesState } from "../src/lib/favicon.js";

describe("favicon state matching", () => {
    it("recognises both shapes the icon set uses", () => {
        // The .ico is the one a prefix-only check misses — and the .ico is
        // also the one Chrome prefers, so missing it is the whole bug.
        expect(matchesState("http://x/favicon/idle.ico", "idle")).toBe(true);
        expect(matchesState("http://x/favicon/idle-16.png", "idle")).toBe(true);
        expect(matchesState("http://x/favicon/idle-180.png", "idle")).toBe(true);
        expect(matchesState("http://x/favicon/play.ico", "play")).toBe(true);
    });

    it("does not confuse the two states", () => {
        expect(matchesState("http://x/favicon/play.ico", "idle")).toBe(false);
        expect(matchesState("http://x/favicon/idle-32.png", "play")).toBe(false);
    });

    it("does not match a state that is only a prefix of the filename", () => {
        // "idler.png" is not the idle icon; the separator is what says so.
        expect(matchesState("http://x/favicon/idler.png", "idle")).toBe(false);
    });
});
