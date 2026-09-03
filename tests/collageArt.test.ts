import { describe, it, expect } from "vitest";
import { artPrompt, scrubBrands } from "../src/lib/collage/artPrompt.js";
import { cellPixels, gridCells, paperBox } from "../src/lib/collage/sheet.js";

/**
 * Asking for the artwork, and cutting up what comes back.
 *
 * Both halves are tested here because they are one contract: the prompt says
 * "a 3 x 3 grid, subjects well inside their cells" and the cutter assumes
 * exactly that. If one drifts the other silently produces rubbish — pieces with
 * a slice of their neighbour, three tool calls later, with nothing to point at.
 */

describe("brand names", () => {
    it("takes the studio out and leaves what was wanted", () => {
        const { topic, removed } = scrubBrands("a fairy tale in the style of Disney");
        expect(topic).not.toMatch(/disney/i);
        expect(topic).toContain("rounded");
        expect(removed).toEqual(["Disney"]);
    });

    it("catches more than one, and reports each once", () => {
        const { topic, removed } = scrubBrands("Pixar meets Ghibli, very Pixar");
        expect(topic).not.toMatch(/pixar|ghibli/i);
        expect(removed).toEqual(["Pixar", "Ghibli"]);
    });

    it("leaves an ordinary topic alone", () => {
        const { topic, removed } = scrubBrands("Little Red Riding Hood");
        expect(topic).toBe("Little Red Riding Hood");
        expect(removed).toEqual([]);
    });

    it("finds a name on the second call too", () => {
        // The matchers are global regexes; reusing one carries lastIndex from
        // the previous call and every second look would come back empty.
        expect(scrubBrands("about Disney").removed).toEqual(["Disney"]);
        expect(scrubBrands("about Disney").removed).toEqual(["Disney"]);
    });
});

describe("the prompt", () => {
    it("asks for the grid it says it asks for", () => {
        const written = artPrompt({ kind: "actors", columns: 3, rows: 3, topic: "a wolf" });
        expect(written.prompt).toContain("3 × 3");
        expect(written.prompt).toContain("9 separate pictures");
        expect(written.subjects).toHaveLength(9);
    });

    it("tells the model the things the cutter depends on", () => {
        // Every one of these is a rule the cut needs, not a preference: touching
        // subjects cannot be separated at all.
        //
        // Separation is asserted, being inside the grid is not. Both cutters
        // need the first; only piece_sheet needs the second, and demanding it
        // as well came back as art filling 82–92% of its cell for no gain.
        const written = artPrompt({ kind: "actors" });
        for (const rule of ["separation", "may touch", "reading order", "no text"]) {
            expect(written.prompt.toLowerCase()).toContain(rule.toLowerCase());
        }
    });

    it("tells the model to fill the cell rather than sit politely inside it", () => {
        // The regression this guards: asking for a gap AND for the subject to
        // stay well inside its cell shrinks the art twice, and the second
        // demand buys nothing a separated sheet does not already have.
        const written = artPrompt({ kind: "scenery" });
        expect(written.prompt).toContain("Fill each cell as fully as the subject can");
        expect(written.prompt).not.toContain("well inside its own cell");
    });

    it("asks for backdrops with nothing in front, because the front is separate", () => {
        // The failure this exists to catch: an image model asked for "a forest"
        // returns one lovely picture with the trunks, ferns and light baked
        // together, and a baked picture cannot be parallaxed or stood in front
        // of. The backdrop has to be the far plane and nothing else.
        const written = artPrompt({ kind: "backgrounds" });
        expect(written.prompt).toContain("FAR BACKDROP");
        expect(written.prompt).toContain("21:9");
        expect(written.prompt.toLowerCase()).toContain("no characters");
        expect(written.prompt).toMatch(/drawn separately|layered on top/);
    });

    it("has a kind for the things that stand in front of the backdrop", () => {
        const written = artPrompt({ kind: "scenery" });
        expect(written.prompt).toContain("ONE piece of scenery");
        expect(written.prompt).toContain("PLAIN WHITE");
        // The reason they are separate at all.
        expect(written.prompt.toLowerCase()).toContain("depths");
    });

    it("asks for actors with their feet visible, because they will walk", () => {
        const written = artPrompt({ kind: "actors" });
        expect(written.prompt).toContain("feet");
        expect(written.prompt).toContain("PLAIN WHITE");
    });

    it("uses the subjects given, and fills the rest", () => {
        const written = artPrompt({ kind: "actors", columns: 2, rows: 2, subjects: ["the wolf"] });
        expect(written.subjects[0]).toBe("the wolf");
        expect(written.subjects).toHaveLength(4);
        expect(written.prompt).toContain("1. the wolf");
    });

    it("keeps the grid to something an image model can actually draw", () => {
        expect(artPrompt({ kind: "actors", columns: 40, rows: 40 }).columns).toBe(5);
    });
});

describe("cutting the sheet up", () => {
    it("walks the cells in reading order", () => {
        const cells = gridCells({ columns: 2, rows: 2, inset: 0, labels: ["a", "b", "c", "d"] });
        expect(cells.map(c => c.label)).toEqual(["a", "b", "c", "d"]);
        expect(cells[1].x).toBeCloseTo(0.5);
        expect(cells[2].y).toBeCloseTo(0.5);
    });

    it("shaves the edge of each cell, to swallow a wandering gutter", () => {
        const cells = gridCells({ columns: 2, rows: 1 });
        expect(cells[0].x).toBeGreaterThan(0);
        expect(cells[0].x + cells[0].width).toBeLessThan(0.5);
    });

    it("never lets two cells share a pixel", () => {
        // Rounded from the far edge rather than by rounding the width: rounding
        // both widths up would overlap by a pixel and put a stripe of the
        // neighbour into every cut.
        const [left, right] = gridCells({ columns: 2, rows: 1, inset: 0 });
        const a = cellPixels(left, 101, 50);
        const b = cellPixels(right, 101, 50);
        expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    });

    it("covers the whole image when nothing is shaved off", () => {
        const cells = gridCells({ columns: 3, rows: 1, inset: 0 });
        const last = cellPixels(cells[2], 99, 10);
        expect(last.x + last.width).toBe(99);
    });
});

describe("the style, which is the part that gets ignored", () => {
    it("says what it must NOT be, not only what it should", () => {
        // The failure this exists to catch: "storybook illustration" is heard
        // as "illustration", and back comes a rendered digital painting with
        // volumetric light in it. The negatives are load-bearing.
        const prompt = artPrompt({ kind: "actors" }).prompt;
        for (const wrong of ["digital painting", "photorealism", "cinematic lighting", "gradients"]) {
            expect(prompt.toLowerCase()).toContain(wrong);
        }
    });

    it("puts the style before the subject", () => {
        // The end of a long prompt is what gets skimmed, and the style is the
        // part that must not be.
        const prompt = artPrompt({ kind: "actors", topic: "a wolf" }).prompt;
        expect(prompt.indexOf("STYLE")).toBeLessThan(prompt.indexOf("Draw ONE sheet"));
    });

    it("asks a backdrop to be flatter than everything else", () => {
        const prompt = artPrompt({ kind: "backgrounds" }).prompt;
        expect(prompt).toContain("silhouettes");
        expect(prompt.toLowerCase()).toContain("plain fields of colour");
    });

    it("names the paper, in every kind", () => {
        for (const kind of ["actors", "backgrounds", "scenery"] as const) {
            expect(artPrompt({ kind }).prompt).toContain("Torn and cut paper collage");
        }
    });
});

describe("flatness, which is what makes a set stageable", () => {
    it("forbids the vanishing point, not just the rendering", () => {
        // A path winding into the distance is beautiful and useless: it cannot
        // be layered, parallaxed, or walked across. Depth has to come from one
        // flat shape in front of another, or there is no theatre here at all.
        const prompt = artPrompt({ kind: "backgrounds" }).prompt.toLowerCase();
        for (const wrong of ["vanishing point", "no perspective", "receding", "foreshortening"]) {
            expect(prompt).toContain(wrong);
        }
        expect(prompt).toContain("straight on");
    });

    it("gives the backdrop a shape budget rather than an adjective", () => {
        // "Almost empty" is a preference and comes back as a full illustration.
        // A number is a rule.
        const prompt = artPrompt({ kind: "backgrounds" }).prompt;
        expect(prompt).toContain("AT MOST FIVE");
        expect(prompt.toLowerCase()).toContain("horizontal band");
    });

    it("names the things that keep turning up in backdrops and should not", () => {
        const prompt = artPrompt({ kind: "backgrounds" }).prompt.toLowerCase();
        for (const wrong of ["no trees in the foreground", "no bushes", "no branches framing"]) {
            expect(prompt).toContain(wrong);
        }
    });

    it("rules out the painting styles an image model reaches for", () => {
        const prompt = artPrompt({ kind: "actors" }).prompt.toLowerCase();
        expect(prompt).toContain("watercolour");
        expect(prompt).toContain("gouache painting");
    });
});

describe("how much comes back per generation", () => {
    it("asks for a full 5 × 5 of anything that gets cut out", () => {
        // Twenty-five pieces from one round trip. A set is made of a lot of
        // small things and generating them one at a time is the slowest
        // possible way to build one.
        for (const kind of ["actors", "scenery"] as const) {
            const written = artPrompt({ kind });
            expect([written.columns, written.rows]).toEqual([5, 5]);
            expect(written.subjects).toHaveLength(25);
        }
    });

    it("stacks backdrops one per row, so the shape cannot come back square", () => {
        // Two reasons, and the second is the interesting one. A backdrop is the
        // picture whose pixels are actually looked at, so it cannot be one of
        // twenty-five stamps. And a grid of four invites four squarish cells
        // however loudly the ratio is stated — where a single column cannot,
        // because each cell spans the whole sheet.
        const written = artPrompt({ kind: "backgrounds" });
        expect(written.columns).toBe(1);
        expect(written.prompt).toContain("full-width");
        expect(written.prompt).toContain("single column");
    });

    it("never asks for the same thing twice on one sheet", () => {
        // The lists cycle, so a short list would ask an image model to draw the
        // same tree three times — it will, and three cells are then worthless.
        for (const kind of ["actors", "scenery"] as const) {
            const subjects = artPrompt({ kind }).subjects;
            expect(new Set(subjects).size).toBe(subjects.length);
        }
    });
});

describe("trimming the paper a backdrop came on", () => {
    /**
     * A backdrop arrives as a torn card centred on a white sheet. Sending it
     * through the background remover with everything else looked reasonable and
     * destroyed it: a remover looks for a SUBJECT, found the trees, and threw
     * away the sky. A winter forest came back as four trunks on nothing.
     *
     * So this is arithmetic. It can crop blank paper; it cannot decide that any
     * of the picture is blank.
     */
    const sheet = (
        width: number,
        height: number,
        ink: (x: number, y: number) => boolean,
        alpha: (x: number, y: number) => number = () => 255,
    ) => {
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const at = (y * width + x) * 4;
                const dark = ink(x, y);
                pixels[at] = pixels[at + 1] = pixels[at + 2] = dark ? 20 : 255;
                pixels[at + 3] = alpha(x, y);
            }
        }
        return pixels;
    };

    it("crops to the picture and leaves the picture alone", () => {
        // Ink from 10..39 across and 5..24 down, white everywhere else.
        const pixels = sheet(50, 30, (x, y) => x >= 10 && x < 40 && y >= 5 && y < 25);
        expect(paperBox(pixels, 50, 30)).toEqual({ x: 10, y: 5, width: 30, height: 20 });
    });

    it("keeps a picture that already fills its cell", () => {
        const pixels = sheet(20, 10, () => true);
        expect(paperBox(pixels, 20, 10)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    });

    it("is not anchored by a speck of texture in the margin", () => {
        // One stray dark pixel near the edge. Without a tolerance it would hold
        // the whole crop open and the trim would do nothing at all.
        const pixels = sheet(100, 40, (x, y) =>
            (x === 1 && y === 1) || (x >= 20 && x < 80 && y >= 10 && y < 30));
        const box = paperBox(pixels, 100, 40);
        expect(box.x).toBe(20);
        expect(box.y).toBe(10);
    });

    it("treats transparent margin as blank, not as picture", () => {
        // A cell that has already been cut out has margin made of nothing
        // rather than of white.
        const pixels = sheet(
            40, 20,
            (x, y) => x >= 8 && x < 32 && y >= 4 && y < 16,
            (x, y) => (x >= 8 && x < 32 && y >= 4 && y < 16 ? 255 : 0));
        expect(paperBox(pixels, 40, 20)).toEqual({ x: 8, y: 4, width: 24, height: 12 });
    });

    it("never collapses to nothing on a blank cell", () => {
        const box = paperBox(sheet(30, 30, () => false), 30, 30);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
    });
});
