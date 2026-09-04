import { describe, it, expect } from "vitest";
import { EFFECTS, findEffect, effectNames, particlesFor } from "../src/lib/collage/effects.js";

describe("the anger effect", () => {
    it("is in the catalogue and reachable by name", () => {
        expect(effectNames()).toContain("anger");
        expect(findEffect("anger")?.seconds).toBeGreaterThan(0);
    });
    it("always throws at least one hash, and only glyph particles", () => {
        for (let run = 0; run < 40; run++) {
            const bits = particlesFor("anger");
            expect(bits.length).toBe(findEffect("anger")!.count);
            expect(bits.every(b => b.shape === "glyph" && b.glyph)).toBe(true);
            expect(bits.some(b => b.glyph === "#")).toBe(true);
        }
    });
    it("is much bigger than a sparkle, and stays readable", () => {
        const anger = particlesFor("anger");
        const sparkles = particlesFor("sparkles");
        const min = Math.min(...anger.map(b => b.size));
        const biggestSparkle = Math.max(...sparkles.map(b => b.size));
        expect(min).toBeGreaterThan(biggestSparkle * 2);
        // A tilt, not a tumble — a spinning symbol cannot be read.
        expect(anger.every(b => Math.abs(b.spin) <= 20)).toBe(true);
    });
    it("does not disturb the effects that were already there", () => {
        expect(EFFECTS.map(e => e.id)).toEqual(
            expect.arrayContaining(["sparkles", "poof", "confetti", "hearts", "rain"]));
        expect(particlesFor("sparkles").every(b => b.shape === "star")).toBe(true);
    });
});
