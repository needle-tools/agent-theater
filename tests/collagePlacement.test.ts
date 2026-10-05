import { describe, expect, it } from "vitest";
import { Collage, bounds } from "../src/lib/collage/model.js";
import { clearRectSpot } from "../src/lib/collage/placement.js";

describe("placing new troupe pieces", () => {
    it("keeps a tall cut-out clear of a wide one", () => {
        const collage = new Collage();
        const wide = collage.addImage({
            src: "wide", natural: { width: 400, height: 100 },
            width: 400, x: -200, y: -50,
        });
        const size = { width: 100, height: 400 };
        const spot = clearRectSpot([wide], { x: 0, y: 0 }, size);
        const placed = { x: spot.x - size.width / 2, y: spot.y - size.height / 2, ...size };
        const other = bounds(wide);
        expect(
            placed.x >= other.x + other.width ||
            placed.x + placed.width <= other.x ||
            placed.y >= other.y + other.height ||
            placed.y + placed.height <= other.y,
        ).toBe(true);
    });

    it("finds distinct places when several pieces arrive in one batch", () => {
        const collage = new Collage();
        const sizes = [
            { width: 250, height: 140 },
            { width: 90, height: 370 },
            { width: 340, height: 80 },
            { width: 180, height: 180 },
        ];
        for (const size of sizes) {
            const spot = clearRectSpot(collage.listAll(), { x: 0, y: 0 }, size);
            collage.addImage({
                src: "piece", natural: size, width: size.width,
                x: spot.x - size.width / 2, y: spot.y - size.height / 2,
            });
        }
        const boxes = collage.listAll().map(bounds);
        for (const [index, a] of boxes.entries()) {
            for (const b of boxes.slice(index + 1)) {
                expect(
                    a.x + a.width <= b.x || b.x + b.width <= a.x ||
                    a.y + a.height <= b.y || b.y + b.height <= a.y,
                ).toBe(true);
            }
        }
    });
});
