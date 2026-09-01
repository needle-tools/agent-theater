import { FONTS, type Layer, type TextLayer } from "./model.js";

/**
 * The playful faces, fetched only once somebody might see one.
 *
 * They are not in brand.css and they are not in the bundle. The front page is a
 * canvas, not a type specimen — most sessions never add a word of text, and
 * those should not pay for seven display faces before first paint. So the
 * stylesheet is injected the first time the font menu opens or a font is
 * applied, and the browser then downloads only the faces something actually
 * renders in.
 *
 * Every stack in model.ts ends in a generic family, which is what makes this
 * safe: if the CDN is blocked, unreachable, or simply slow, the collage draws in
 * something of the right shape rather than waiting or breaking.
 */

const WEB_FONTS = FONTS.filter(font => font.google);

/** One stylesheet for all of them — one request, and the browser picks. */
export const FONTS_HREF =
    `https://fonts.googleapis.com/css2?${WEB_FONTS.map(f => `family=${f.google}`).join("&")}&display=swap`;

/** For exported HTML, which lands on a page that has never heard of these. */
export const FONTS_IMPORT = `@import url("${FONTS_HREF}");`;

/** Does this font stack name a face that has to be fetched? */
export function isWebFont(stack: string): boolean {
    return WEB_FONTS.some(font => font.stack === stack);
}

/** The web fonts a set of layers actually uses — empty for most collages. */
export function webFontsUsed(layers: readonly Layer[]): string[] {
    const used = new Set<string>();
    for (const layer of layers) {
        if (layer.kind === "text" && isWebFont((layer as TextLayer).fontFamily)) {
            used.add((layer as TextLayer).fontFamily);
        }
    }
    return [...used];
}

let loading: Promise<void> | null = null;

/**
 * Put the stylesheet on the page. Safe to call as often as you like; the work
 * happens once and every caller waits on the same promise.
 */
export function loadWebFonts(): Promise<void> {
    if (loading) return loading;
    if (typeof document === "undefined") return Promise.resolve();

    loading = new Promise<void>(resolve => {
        // Warm both hosts before the stylesheet names a file on the second one.
        // Without this the font files wait on a fresh TLS handshake that only
        // starts after the CSS has parsed.
        for (const [href, crossOrigin] of [
            ["https://fonts.googleapis.com", false],
            ["https://fonts.gstatic.com", true],
        ] as const) {
            const preconnect = document.createElement("link");
            preconnect.rel = "preconnect";
            preconnect.href = href;
            if (crossOrigin) preconnect.crossOrigin = "anonymous";
            document.head.append(preconnect);
        }

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = FONTS_HREF;
        // Resolving on error as well as on load: a blocked CDN should let the
        // collage fall back to the end of each stack, not hang an export
        // forever waiting for a face that is never coming.
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.append(link);
    });
    return loading;
}

/**
 * Wait until the faces these layers ask for can be drawn.
 *
 * The canvas renderer sets `ctx.font` and draws immediately; a face that has
 * not arrived yet is not an error there, it is a silent fall back to the
 * generic family. So anything that rasterises — export, capture, thumbnails —
 * has to ask first, or an exported PNG quietly disagrees with the screen.
 */
export async function fontsReady(layers: readonly Layer[]): Promise<void> {
    const stacks = webFontsUsed(layers);
    if (!stacks.length) return;
    await loadWebFonts();
    if (typeof document === "undefined" || !document.fonts) return;

    const texts = layers.filter(l => l.kind === "text") as TextLayer[];
    await Promise.all(texts
        .filter(text => stacks.includes(text.fontFamily))
        // Size is part of the shorthand and must be a real length, but it does
        // not affect which file is fetched — one face covers every size.
        .map(text => document.fonts
            .load(`${text.fontWeight} ${Math.max(1, Math.round(text.fontSize))}px ${text.fontFamily}`)
            .catch(() => [])));
}
