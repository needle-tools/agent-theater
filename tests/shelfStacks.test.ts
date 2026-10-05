import { describe, expect, it } from "vitest";
import { TROUPE } from "../src/lib/collage/troupe.js";
import { shelfStacks } from "../src/lib/collage/shelfStacks.js";

describe("sticker shelf stacks", () => {
    it("shows at most five stacks and makes every sticker available exactly once", () => {
        const stacks = shelfStacks();
        const expected = TROUPE.filter(piece => piece.kind === "actor" || piece.kind === "scenery")
            .map(piece => piece.id).sort();
        const actual = stacks.flatMap(stack => stack.pieces).map(piece => piece.id).sort();

        expect(stacks.length).toBeLessThanOrEqual(5);
        expect(actual).toEqual(expected);
        expect(new Set(actual).size).toBe(actual.length);
    });
});
