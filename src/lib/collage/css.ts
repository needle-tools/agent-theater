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
 * The drop shadow, and a reference to the outline filter when there is one.
 *
 * The outline is NOT a ring of drop-shadows here, and that is the whole point.
 * CSS filters chain: each one is applied to the output of the previous, so a
 * "ring" of sixteen stamps is sixteen sequential full-size buffer allocations,
 * each on a canvas the last one just grew. On photo-sized layers that is enough
 * to take the renderer down, and it does not even look right — the offsets
 * compound instead of forming an even stroke.
 *
 * `feMorphology operator="dilate"` is the primitive that actually means "spread
 * this alpha outwards". One pass, uniform by definition. See `outlineFilterSvg`.
 */
export function alphaFilters(style: LayerStyle, unit: Unit, outlineFilterId?: string): string {
    const filters: string[] = [];

    if (outlineFilterId && style.outline && style.outline.width > 0) {
        filters.push(`url(#${outlineFilterId})`);
    }

    if (style.shadow) {
        const { x, y, blur, color, opacity } = style.shadow;
        filters.push(`drop-shadow(${unit(x)} ${unit(y)} ${unit(blur)} ${withOpacity(color, opacity)})`);
    }

    return filters.join(" ");
}

/**
 * An SVG filter that strokes the edge of whatever it is applied to.
 *
 * `primitiveUnits="objectBoundingBox"` makes the radius a fraction of the
 * element's box rather than a pixel count, which is what keeps the stroke the
 * right thickness in an exported page that resizes with its column. The two
 * radii differ deliberately: a fraction of the width and a fraction of the
 * height both come out to the same number of rendered pixels only if they are
 * computed separately.
 */
export function outlineFilterSvg(
    id: string,
    outline: { width: number; color: string },
    layerWidth: number,
    layerHeight: number,
): string {
    const rx = round(outline.width / Math.max(1, layerWidth), 5);
    const ry = round(outline.width / Math.max(1, layerHeight), 5);
    return `<filter id="${id}" primitiveUnits="objectBoundingBox" ` +
        `x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
        `<feMorphology in="SourceAlpha" operator="dilate" radius="${rx} ${ry}" result="spread"/>` +
        `<feFlood flood-color="${cssColor(outline.color)}" result="colour"/>` +
        `<feComposite in="colour" in2="spread" operator="in" result="edge"/>` +
        `<feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge>` +
        `</filter>`;
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
