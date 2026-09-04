import { describe, it, expect } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { bandDepth, posterCast, posterRegion, POSTER_SIZE } from "../src/lib/collage/poster.js";

/**
 * The front of a saved play is a poster, not a screenshot — the leads step
 * forward and stand large in the middle. Everything below is about the one
 * rule that makes that safe: the poster is a picture, the chunk behind it is
 * the play, and the layout may not touch the document it is a picture of.
 */

const AREA = { x: 0, y: 0, width: 1200, height: 700 };

function company() {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const add = (label: string, width: number, height: number) =>
        collage.addImage({
            src: `https://cdn.example.test/${label}.png`,
            label,
            // Height follows the aspect, as it does everywhere: the model
            // will not take one, because a stretched cut-out is never a choice.
            natural: { width: width * 2, height: height * 2 },
            x: 0, y: 0, width,
        });
    return { collage, add };
}

describe("posterCast", () => {
    it("deals the leads outwards from the middle, tallest in the centre", () => {
        const { collage, add } = company();
        const star = add("grandmother", 100, 200);
        const second = add("wolf", 100, 200);
        const third = add("woodcutter", 100, 200);

        const row = posterCast([star.id, second.id, third.id], collage.list(), AREA);

        // Left to right: second, star, third — the star in the middle.
        expect(row.map(piece => piece.id)).toEqual([second.id, star.id, third.id]);
        expect(row[1].height).toBeGreaterThan(row[0].height);
        expect(row[1].height).toBeGreaterThan(row[2].height);
        // And nearest the audience, so an overlapping row reads front to back.
        expect(row[1].z).toBeGreaterThan(row[0].z);
        expect(row[1].z).toBeGreaterThan(row[2].z);
    });

    it("stands them on one line, centred, leaning away from the middle", () => {
        const { collage, add } = company();
        const ids = [add("a", 100, 200), add("b", 90, 180), add("c", 120, 160)].map(l => l.id);

        const row = posterCast(ids, collage.list(), AREA);

        const bottoms = row.map(piece => piece.y + piece.height);
        // The flanks step back up the stage; nobody's feet leave the floor.
        for (const bottom of bottoms) {
            expect(bottom).toBeLessThanOrEqual(AREA.y + AREA.height + 0.001);
            expect(bottom).toBeGreaterThan(AREA.y + AREA.height * 0.9);
        }
        expect(row[0].rotation).toBeLessThan(0);
        expect(row[1].rotation).toBe(0);
        expect(row[2].rotation).toBeGreaterThan(0);

        const left = Math.min(...row.map(p => p.x));
        const right = Math.max(...row.map(p => p.x + p.width));
        // Centred on the picture, to within the lean either side.
        expect(Math.abs((left + right) / 2 - (AREA.x + AREA.width / 2))).toBeLessThan(1);
    });

    it("brings them forward — a lead is far larger on the poster than on the stage", () => {
        const { collage, add } = company();
        const star = add("mouse", 40, 60);

        const [placed] = posterCast([star.id], collage.list(), AREA);

        expect(placed.height).toBeGreaterThan(star.height * 4);
        // Stretched cut-outs look like a mistake, never like a choice.
        expect(placed.width / placed.height).toBeCloseTo(star.width / star.height, 5);
    });

    it("keeps the whole row on the paper, however wide the company is", () => {
        const { collage, add } = company();
        // Three very wide pieces would otherwise spread past both edges.
        const ids = [add("ship", 900, 200), add("whale", 900, 200), add("pier", 900, 200)]
            .map(layer => layer.id);

        const row = posterCast(ids, collage.list(), AREA);

        expect(Math.min(...row.map(p => p.x))).toBeGreaterThanOrEqual(AREA.x);
        expect(Math.max(...row.map(p => p.x + p.width))).toBeLessThanOrEqual(AREA.x + AREA.width);
    });

    it("skips a lead whose picture is gone rather than leaving a gap", () => {
        const { collage, add } = company();
        const star = add("bird", 100, 200);
        const text = collage.addText({ text: "the end", x: 0, y: 0, width: 200 });

        const row = posterCast([star.id, "deleted", text.id], collage.list(), AREA);

        expect(row.map(piece => piece.id)).toEqual([star.id]);
    });

    it("never writes to the document it is a picture of", () => {
        const { collage, add } = company();
        const star = add("cat", 100, 200);
        const before = JSON.stringify(collage.list());

        const [placed] = posterCast([star.id], collage.list(), AREA);
        placed.x = -999;

        expect(JSON.stringify(collage.list())).toBe(before);
        expect(collage.get(star.id)!.width).toBe(100);
    });

    it("has nothing to say about a play with no cast", () => {
        const { collage } = company();
        expect(posterCast([], collage.list(), AREA)).toEqual([]);
    });

    it("lets a lead go of whatever it was holding on to", () => {
        const { collage, add } = company();
        const horse = add("horse", 200, 160);
        const rider = add("rider", 80, 140);
        collage.update(rider.id, { held: { by: horse.id, x: 10, y: -20 } });

        const [placed] = posterCast([rider.id], collage.list(), AREA) as ImageLayer[];

        // Offsets from somebody who is not standing there any more are not a
        // position — and the real layer keeps its hand.
        expect(placed.held).toBeUndefined();
        expect(collage.get(rider.id)!.held).toEqual({ by: horse.id, x: 10, y: -20 });
    });
});

describe("bandDepth", () => {
    it("stays a strip on a tall page instead of a sixth of it", () => {
        // A4 portrait at save size. A share of the height alone would give a
        // band deep enough that the title, set from that depth, is shouldered
        // off the strip by the address and the stamp — which is how it went
        // missing on portrait pages and nowhere else.
        const portrait = bandDepth(1131, 1600);
        expect(portrait).toBeLessThan(1600 * 0.16);
        expect(portrait / 1131).toBeLessThan(0.14);
    });

    it("leaves a wide page's band alone", () => {
        expect(bandDepth(1600, 840)).toBe(Math.round(840 * 0.16));
    });

    it("keeps a floor under a small one, so the band stays legible", () => {
        expect(bandDepth(320, 180)).toBeGreaterThanOrEqual(76);
    });
});

describe("posterRegion", () => {
    const OG = POSTER_SIZE;
    const band = bandDepth(OG.width, OG.height);
    /** What one canvas unit is worth in poster pixels, per axis. */
    const scales = (frame: { x: number; y: number; width: number; height: number }) => {
        const region = posterRegion(frame, OG.width, OG.height, band);
        return { x: OG.width / region.width, y: OG.height / region.height, region };
    };

    it("is the card's shape whatever shape the page is", () => {
        for (const page of [
            { x: 0, y: 0, width: 1200, height: 630 },
            { x: 0, y: 0, width: 794, height: 1123 },
            { x: 0, y: 0, width: 900, height: 900 },
            { x: -400, y: 120, width: 1920, height: 1080 },
        ]) {
            const region = posterRegion(page, OG.width, OG.height, band);
            expect(region.width / region.height).toBeCloseTo(OG.width / OG.height, 6);
        }
    });

    it("never stretches — one scale, both axes", () => {
        for (const page of [
            { x: 0, y: 0, width: 794, height: 1123 },
            { x: 0, y: 0, width: 900, height: 900 },
            { x: 0, y: 0, width: 2400, height: 500 },
        ]) {
            const { x, y } = scales(page);
            expect(x).toBeCloseTo(y, 6);
        }
    });

    it("never crops the page off the poster", () => {
        // A tall page loses nothing: the part that would go is the top or the
        // sides of somebody's set.
        const page = { x: 0, y: 0, width: 794, height: 1123 };
        const { region } = scales(page);
        expect(region.x).toBeLessThanOrEqual(page.x);
        expect(region.y).toBeLessThanOrEqual(page.y);
        expect(region.x + region.width).toBeGreaterThanOrEqual(page.x + page.width);
        expect(region.y + region.height).toBeGreaterThanOrEqual(page.y + page.height);
    });

    it("centres the page above the band, not behind it", () => {
        const page = { x: 0, y: 0, width: 900, height: 900 };
        const { region, y: scale } = scales(page);
        const centreInPoster = (page.y + page.height / 2 - region.y) * scale;
        // The picture is what is left above the band; a set centred on the
        // whole poster would stand with its feet under the paper strip.
        expect(centreInPoster).toBeCloseTo((OG.height - band) / 2, 2);
        expect(centreInPoster).toBeLessThan(OG.height / 2);
    });

    it("follows a page that is not at the origin", () => {
        const page = { x: -640, y: 275, width: 1200, height: 630 };
        const { region, x: scale } = scales(page);
        expect((page.x + page.width / 2 - region.x) * scale).toBeCloseTo(OG.width / 2, 2);
    });
});
