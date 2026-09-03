import { describe, expect, it } from "vitest";
import { TROUPE, TROUPE_SHELF } from "../src/lib/collage/troupe.js";

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

describe("troupe shelf catalogue", () => {
    it("keeps the everyday piles ordered and makes the cast explicit", () => {
        expect(TROUPE_SHELF.assorted.slice(0, 2).map(group => group.label)).toEqual([
            "Animal actors",
            "Story actors",
        ]);
        expect(TROUPE_SHELF.assorted.slice(0, 2).every(group =>
            group.kinds.length === 1 && group.kinds[0] === "actor")).toBe(true);
    });

    it("offers only the five complete new packs as themes", () => {
        expect(TROUPE_SHELF.themes.map(group => group.id)).toEqual([
            "birthday-party",
            "lost-and-found",
            "moon-magic",
            "pirate-cove",
            "whimsical-kingdom",
        ]);
        expect(TROUPE_SHELF.themes.every(group =>
            TROUPE.some(piece => group.packs.includes(piece.pack) && piece.kind === "actor") &&
            TROUPE.some(piece => group.packs.includes(piece.pack) && piece.kind === "scenery"),
        )).toBe(true);
    });
});
