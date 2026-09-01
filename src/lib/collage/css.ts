/**
 * CSS the editor and the HTML export both need.
 *
 * These two must agree or the promise breaks: what you arrange on screen is
 * what lands in the exported page. They differ only in units — the editor works
 * in canvas pixels inside a scaled container, the export works in container
 * query units so it stays responsive — so the unit conversion is a parameter
 * and everything else is shared.
 */
import type { LayerStyle } from "./model.js";

/** Turns a length in canvas units into a CSS length. */
export type Unit = (canvasUnits: number) => string;

export const pxUnit: Unit = n => `${round(n, 2)}px`;

export function cqwUnit(frameWidth: number): Unit {
    return n => `${round((n / frameWidth) * 100, 3)}cqw`;
}

/**
 * Sticker outline and drop shadow, both driven by the image's own alpha.
 *
 * There is no filter that strokes an alpha edge, so the outline is eight
 * zero-blur drop shadows in a ring. Eight is where the corners stop showing at
 * usual widths; more only costs paint time.
 */
export function alphaFilters(style: LayerStyle, unit: Unit): string {
    const filters: string[] = [];

    if (style.outline && style.outline.width > 0) {
        const color = cssColor(style.outline.color);
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            filters.push(
                `drop-shadow(${unit(Math.cos(angle) * style.outline.width)} ` +
                `${unit(Math.sin(angle) * style.outline.width)} 0 ${color})`);
        }
    }

    if (style.shadow) {
        const { x, y, blur, color, opacity } = style.shadow;
        filters.push(`drop-shadow(${unit(x)} ${unit(y)} ${unit(blur)} ${withOpacity(color, opacity)})`);
    }

    return filters.join(" ");
}

/**
 * Colours arrive from agent arguments and are written into a stylesheet, so
 * anything that is not a plain colour token is replaced rather than escaped.
 * No legitimate colour contains a brace or a semicolon, and letting one through
 * would let a tool argument write CSS rules of its own.
 */
export function cssColor(value: string): string {
    const trimmed = (value ?? "").trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    if (/^[a-zA-Z]+$/.test(trimmed)) return trimmed;
    if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/.test(trimmed)) return trimmed;
    return "#000000";
}

export function withOpacity(color: string, opacity: number): string {
    const safe = cssColor(color);
    const alpha = Math.min(1, Math.max(0, opacity));
    if (alpha >= 1) return safe;
    // color-mix keeps this working for named colours and hex alike.
    return `color-mix(in srgb, ${safe} ${round(alpha * 100, 1)}%, transparent)`;
}

/** Font shorthand pieces shared by the editor and the export. */
export function textCss(layer: {
    color: string;
    fontFamily: string;
    fontWeight: number;
    align: string;
}): string[] {
    return [
        `color: ${cssColor(layer.color)}`,
        `font-family: ${layer.fontFamily}`,
        `font-weight: ${Math.round(layer.fontWeight)}`,
        `text-align: ${layer.align}`,
        `line-height: 1.15`,
    ];
}

export function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
