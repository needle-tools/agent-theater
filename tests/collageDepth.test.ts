import { describe, it, expect } from "vitest";
import { paintOrder } from "../src/lib/collage/depth.js";

/** A piece standing on the paper. */
const at = (id: string, x: number, y: number, width = 100, height = 100, held?: string) =>
    ({ id, x, y, width, height, z: 0, ...(held ? { held: { by: held } } : {}) });

const order = (list: ReturnType<typeof at>[]) =>
    paintOrder(list).sort((a, b) => a.z - b.z).map(layer => layer.id);

describe("who is painted over whom", () => {
    it("puts whoever stands lower in front", () => {
        // The bug: paint order was the order the pieces were added in, so the
        // last one added stood in front of the whole company for a whole play.
        expect(order([at("wolf", 0, 400), at("red", 100, 600), at("gran", 200, 200)]))
            .toEqual(["gran", "wolf", "red"]);
    });

    it("re-sorts as somebody walks upstage", () => {
        expect(order([at("red", 0, 600), at("wolf", 40, 400)])).toEqual(["wolf", "red"]);
        expect(order([at("red", 0, 200), at("wolf", 40, 400)])).toEqual(["red", "wolf"]);
    });

    it("keeps a backdrop behind everybody standing on it", () => {
        // Found by what it contains, not by how big it is: a card the cast is
        // standing on top of is behind them, whatever its base does.
        const sky = at("sky", 0, 0, 2000, 1200);
        expect(order([at("red", 400, 500), sky, at("wolf", 900, 700), at("gran", 200, 300)]))
            .toEqual(["sky", "gran", "red", "wolf"]);
    });

    it("does not mistake a tree for a backdrop", () => {
        // A tree stands on the floor like anything else. Downstage of somebody
        // means in front of them, which is the whole rule.
        const tree = at("tree", 300, 100, 200, 600);
        expect(order([tree, at("red", 100, 400)])).toEqual(["red", "tree"]);
        expect(order([tree, at("red", 100, 650)])).toEqual(["tree", "red"]);
    });

    it("puts the bigger backdrop furthest back", () => {
        const sky = at("sky", 0, 0, 2000, 1200);
        const field = at("field", 100, 200, 1600, 900);
        expect(order([field, sky, at("red", 400, 500), at("wolf", 900, 700), at("gran", 500, 400)]))
            .toEqual(["sky", "field", "gran", "red", "wolf"]);
    });

    it("stacks two pieces on the same line the way they were left", () => {
        expect(order([at("bench", 0, 500), at("cat", 40, 500)])).toEqual(["bench", "cat"]);
    });

    it("draws a held prop just above the hand holding it", () => {
        const sorted = paintOrder([
            at("basket", 0, 900, 60, 60, "red"), at("red", 0, 500), at("wolf", 40, 700),
        ]);
        const z = Object.fromEntries(sorted.map(layer => [layer.id, layer.z]));
        expect(z.basket).toBe(z.red + 1);
        expect(z.basket).toBeLessThan(z.wolf);
    });
});
