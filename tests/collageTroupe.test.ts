import { describe, expect, it } from "vitest";
import { TROUPE } from "../src/lib/collage/troupe.js";

describe("troupe facing metadata", () => {
    it("keeps manifest facing information in the generated registry", () => {
        expect(TROUPE.find(piece => piece.id === "fairy-tale/king")?.facing).toBe("front");
        expect(TROUPE.find(piece => piece.id === "animals/crocodile")?.facing).toBe("right");
        expect(TROUPE.find(piece => piece.id === "animals/kangaroo")?.facing).toBe("left");
        expect(TROUPE.find(piece => piece.id === "street/train-engine")?.facing).toBe("left");
    });

    it("never leaves an ambiguous side value in the registry", () => {
        expect(TROUPE.every(piece =>
            piece.facing == null || ["front", "left", "right"].includes(piece.facing))).toBe(true);
    });
});
