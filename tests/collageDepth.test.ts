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

    it("keeps a surface behind what stands on it, whatever its legs do", () => {
        // The office bug: a desk's legs gave it the lowest base on the stage,
        // so the whole desk counted as nearest and swallowed the sushi set on
        // its face and the gardener standing at it. A much bigger piece whose
        // box holds your centre is a SURFACE, and a surface paints behind you.
        // Enough of the cast stands CLEAR of the desk that it does not count
        // as a backdrop — in the real office it held five of eighteen — so
        // this pins the surface rule itself, not the backdrop heuristic.
        const desk = at("desk", 300, 100, 900, 500);
        const sushi = at("sushi", 600, 200, 80, 60);
        const gardener = at("gardener", 400, 150, 140, 400);
        const crowd = [
            at("captain", 1400, 200, 140, 400), at("robot", 1600, 300, 120, 300),
            at("printer", 1400, 700, 200, 150), at("plant", 100, 700, 100, 200),
        ];
        const z = Object.fromEntries(
            paintOrder([desk, sushi, gardener, ...crowd]).map(layer => [layer.id, layer.z]));
        expect(z.sushi).toBeGreaterThan(z.desk);
        expect(z.gardener).toBeGreaterThan(z.desk);
    });

    it("leaves comparable actors to the honest base rule", () => {
        // Two people overlapping are not furniture: the lower one is nearer,
        // exactly as before — the surface rule needs a MUCH bigger piece.
        expect(order([at("wolf", 0, 400, 120, 300), at("red", 40, 500, 100, 280)]))
            .toEqual(["wolf", "red"]);
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
