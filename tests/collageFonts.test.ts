import { describe, it, expect } from "vitest";
import { Collage, FONTS, findFont } from "../src/lib/collage/model.js";
import { FONTS_HREF, FONTS_IMPORT, fontsReady, isWebFont, loadWebFonts, webFontsUsed } from "../src/lib/collage/webfonts.js";
import { exportHtml } from "../src/lib/collage/exportHtml.js";

/**
 * The fetched typefaces.
 *
 * Two things have to hold or a collage silently changes when it leaves the
 * screen: a face that is only on this page must travel with an export, and
 * anything that rasterises must wait for the face before it draws. Both are
 * invisible when they break — the text still appears, just in the wrong font.
 */

describe("the font list", () => {
    it("offers faces that do something the brand ones cannot", () => {
        expect(FONTS.length).toBeGreaterThan(5);
        expect(FONTS.some(f => f.google)).toBe(true);
    });

    it("keeps every stack ending in a generic family", () => {
        // The fallback is what makes lazy loading safe: a blocked CDN costs the
        // exact face, not the layout.
        const generics = ["sans-serif", "serif", "monospace", "cursive"];
        for (const font of FONTS) {
            const last = font.stack.split(",").pop()!.trim();
            expect(generics, `${font.id} ends in "${last}"`).toContain(last);
        }
    });

    it("gives every fetched face a distinct id and a short name", () => {
        expect(new Set(FONTS.map(f => f.id)).size).toBe(FONTS.length);
        // The menu renders the name in the face itself, so a long one would set
        // a wide display face past the edge of the submenu.
        for (const font of FONTS) expect(font.name.length).toBeLessThanOrEqual(8);
    });

    it("is the same list the agent tools name", () => {
        for (const font of FONTS) expect(findFont(font.id)).toBe(font);
        expect(findFont("comic-sans")).toBeNull();
    });

    it("asks the CDN for exactly the families it lists", () => {
        const fetched = FONTS.filter(f => f.google);
        for (const font of fetched) expect(FONTS_HREF).toContain(`family=${font.google}`);
        expect(FONTS_HREF).toContain("display=swap");
        // Swap, not block: text shows immediately in the fallback and changes
        // when the face lands, rather than the collage rendering blank first.
    });
});

describe("recognising a fetched face", () => {
    it("knows a brand face from one that has to be downloaded", () => {
        expect(isWebFont(findFont("poster")!.stack)).toBe(true);
        expect(isWebFont(findFont("display")!.stack)).toBe(false);
        expect(isWebFont("Comic Sans MS, cursive")).toBe(false);
    });

    it("reports only the fetched faces a collage actually uses", () => {
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        collage.addImage({ src: "a", natural: { width: 10, height: 10 }, width: 50 });
        const plain = collage.addText({ text: "plain" });
        expect(webFontsUsed(collage.list())).toEqual([]);

        collage.update(plain.id, { fontFamily: findFont("marker")!.stack });
        collage.addText({ text: "also marker", fontFamily: findFont("marker")!.stack });

        // Once each, however many layers use it.
        expect(webFontsUsed(collage.list())).toEqual([findFont("marker")!.stack]);
    });
});

describe("outside a browser", () => {
    it("does not try to reach the network", async () => {
        // The tools run server-side in tests and the export path is shared, so
        // these have to be no-ops rather than crashes when there is no document.
        await expect(loadWebFonts()).resolves.toBeUndefined();
        await expect(fontsReady([])).resolves.toBeUndefined();
    });
});

describe("exported HTML", () => {
    function exported(fontId: string) {
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const frame = collage.addFrame({ presetId: "square-1080", x: 0, y: 0, width: 500, height: 500 });
        collage.addText({ text: "Hello", x: 10, y: 10, width: 200, fontFamily: findFont(fontId)!.stack });
        return exportHtml(collage.list(), frame);
    }

    it("brings a fetched face with it", () => {
        const html = exported("juicy");
        expect(html).toContain(FONTS_IMPORT);
        expect(html).toContain("Shrikhand");
    });

    it("puts the import before any other rule", () => {
        // @import is only honoured at the top of a stylesheet; one rule above it
        // and the browser drops it and the collage renders in Georgia.
        const html = exported("juicy");
        const css = html.slice(html.indexOf("<style>"));
        expect(css.indexOf("@import")).toBeLessThan(css.indexOf("{"));
    });

    it("does not reach for the CDN when no fetched face is used", () => {
        const html = exported("display");
        expect(html).not.toContain("@import");
        expect(html).not.toContain("fonts.googleapis.com");
    });
});
