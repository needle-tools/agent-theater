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

describe("smoke and explosion", () => {
    it("are both in the catalogue", () => {
        expect(effectNames()).toEqual(expect.arrayContaining(["smoke", "explosion"]));
    });

    it("smoke only ever rises", () => {
        // dy is negative for up. A puff that drifted down would read as ash.
        const bits = particlesFor("smoke");
        expect(bits.length).toBeGreaterThan(0);
        expect(bits.every(b => b.dy < 0)).toBe(true);
        // Slower than anything else: the longest-lived effect in the set.
        expect(findEffect("smoke")!.seconds).toBeGreaterThan(findEffect("confetti")!.seconds);
    });

    it("an explosion is shards AND smoke, not one or the other", () => {
        for (let run = 0; run < 20; run++) {
            const bits = particlesFor("explosion");
            const shards = bits.filter(b => b.shape === "strip");
            const smoke = bits.filter(b => b.shape === "dot");
            expect(shards.length).toBeGreaterThan(0);
            expect(smoke.length).toBeGreaterThan(0);
            // The smoke outlives the shards, which is what makes it wreckage
            // rather than confetti fired sideways.
            const latestShard = Math.max(...shards.map(b => b.delay + b.life));
            const latestSmoke = Math.max(...smoke.map(b => b.delay + b.life));
            expect(latestSmoke).toBeGreaterThan(latestShard);
            // Every smoke bit rises; shards go in all directions.
            expect(smoke.every(b => b.dy < 0)).toBe(true);
            expect(shards.some(b => b.dy > 0)).toBe(true);
        }
    });
});
