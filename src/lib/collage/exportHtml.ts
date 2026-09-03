/**
 * "I want this for my website" — the collage as code.
 *
 * Everything here is derived from `placementIn`, so every number written out is
 * a percentage of the frame. That single choice is what makes the result
 * responsive with no media queries and no JavaScript: the container declares an
 * `aspect-ratio`, the layers are positioned in `%`, and the whole thing scales
 * to whatever column it is dropped into.
 *
 * Type scales with it too, via container query units (`cqw`) rather than `vw` —
 * a collage in a sidebar should size its headline against the sidebar, not
 * against the browser window.
 *
 * Constraints this output has to meet, because it lands in someone else's page:
 *  - no build step, no dependencies, no external stylesheet
 *  - every class prefixed, so nothing collides with the host site's CSS
 *  - text stays real text: selectable, translatable, in the accessibility tree
 *  - images keep their alt text
 *  - motion is opt-in and respects prefers-reduced-motion
 */
import { placementIn, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
import { alphaFilters, cqwUnit, cssColor, outlineFilterSvg, round } from "./css.js";
import { FONTS_IMPORT, webFontsUsed } from "./webfonts.js";

export interface HtmlExportOptions {
    /** Class prefix. Everything emitted is namespaced under it. */
    className?: string;
    /** Wrap the result in a complete HTML document — for an embed or a deploy. */
    document?: boolean;
    /** Hover lift on each cut-out. Off by default; a poster is not a toy. */
    interactive?: boolean;
    title?: string;
    /**
     * Resolved sources, by layer id. The browser fills this with data: URIs
     * when the user asked for a self-contained snippet; without it, the
     * original URLs are written and the snippet stays small but remote.
     */
    sources?: Record<string, string>;
}

export function exportHtml(layers: Layer[], frame: Frame, options: HtmlExportOptions = {}): string {
    const root = (options.className ?? "collage").replace(/[^a-zA-Z0-9_-]/g, "") || "collage";
    const ordered = [...layers].sort((a, b) => a.z - b.z);
    const css = [
        // The destination page has never heard of Anton or Shrikhand, so the
        // collage has to bring them. Only when one is actually used, and first
        // in the sheet because @import has to precede every other rule.
        webFontsUsed(ordered).length ? FONTS_IMPORT : "",
        rootCss(root, frame),
        ...ordered.map((layer, index) => layerCss(root, index, layer, frame)),
        options.interactive ? interactiveCss(root) : "",
    ].filter(Boolean).join("\n\n");

    const markup = ordered
        .map((layer, index) => (layer.kind === "image"
            ? imageMarkup(root, index, layer, options)
            : textMarkup(root, index, layer)))
        .join("\n");

    // One dilate filter per outlined layer. A chain of drop-shadows would be a
    // full-size buffer allocation per stamp, on someone else's page.
    const filters = ordered
        .map((layer, index) => (layer.kind === "image" && layer.style.outline && layer.style.outline.width > 0
            ? outlineFilterSvg(`${root}-outline-${index}`, layer.style.outline, layer.width, layer.height)
            : ""))
        .filter(Boolean)
        .join("");

    const defs = filters
        ? `\n    <svg width="0" height="0" aria-hidden="true" focusable="false" ` +
          `style="position:absolute">${filters}</svg>`
        : "";

    const body =
        `<div class="${root}">\n${indent(markup, 4)}${defs}\n</div>`;

    const style = `<style>\n${indent(css, 4)}\n</style>`;

    if (!options.document) return `${style}\n\n${body}\n`;

    const title = escapeHtml(options.title ?? frame.name);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
    body { margin: 0; display: grid; place-items: center; min-height: 100svh; background: #EFF5EC; }
    .${root}-page { width: min(100%, 1200px); }
</style>
${style}
</head>
<body>
<div class="${root}-page">
${indent(body, 4)}
</div>
</body>
</html>
`;
}

function rootCss(root: string, frame: Frame): string {
    return `.${root} {
    position: relative;
    width: 100%;
    aspect-ratio: ${round(frame.width, 3)} / ${round(frame.height, 3)};
    background: ${cssColor(frame.background)};
    overflow: hidden;
    /* Makes cqw units below resolve against this box, so the collage scales
       against its own column rather than the viewport. */
    container-type: inline-size;
}

.${root} > * {
    position: absolute;
    margin: 0;
}

.${root} figure {
    overflow: visible;
}

/* Crop the artwork inside an unclipped figure. The figure's filter therefore
   sees the cropped silhouette but its shadow can extend past the crop box. */
.${root} figure > .${root}__crop {
    position: absolute;
    inset: 0;
    overflow: hidden;
}

/* An <img>, or a masked <span> for a silhouette. Both are sized and offset per
   layer below to show only the cropped region. */
.${root} figure > .${root}__crop > * {
    position: absolute;
    display: block;
    max-width: none;
}`;
}

function layerCss(root: string, index: number, layer: Layer, frame: Frame): string {
    const place = placementIn(layer, frame);
    const selector = `.${root}__l${index}`;
    const rules = [
        `left: ${pct(place.left)};`,
        `top: ${pct(place.top)};`,
        `width: ${pct(place.width)};`,
    ];

    if (layer.kind === "image") {
        rules.push(`height: ${pct(place.height)};`);
    }
    // Rotation is held in a custom property so a hover transform can re-apply
    // it without every layer needing its own hover rule.
    rules.push(`--r: ${round(place.rotation, 2)}deg;`);
    rules.push(`transform: rotate(var(--r)) scale(var(--s, 1));`);
    if (layer.kind === "image") {
        const filters = alphaFilters(layer.style, cqwUnit(frame.width), `${root}-outline-${index}`);
        if (filters) rules.push(`filter: ${filters};`);
        if (layer.style.opacity !== 1) rules.push(`opacity: ${round(layer.style.opacity, 2)};`);
    }

    let css = `${selector} {\n${rules.map(r => `    ${r}`).join("\n")}\n}`;

    if (layer.kind === "image") {
        const inner = [
            `width: ${pct(1 / Math.max(0.0001, layer.crop.width))};`,
            `height: ${pct(1 / Math.max(0.0001, layer.crop.height))};`,
            `left: ${pct(-layer.crop.x / Math.max(0.0001, layer.crop.width))};`,
            `top: ${pct(-layer.crop.y / Math.max(0.0001, layer.crop.height))};`,
        ];
        if (layer.style.silhouette) {
            // The cut-out's own alpha becomes a mask and the colour is painted
            // through it — a flat silhouette with no second asset to ship.
            //
            // This is why the silhouette case emits a <span> rather than an
            // <img>: a background on an <img> paints *behind* its pixels, so the
            // photo would simply cover the colour. An empty element has no
            // pixels of its own, and the mask gives it the shape.
            const url = `var(--src)`;
            inner.push(
                `background: ${cssColor(layer.style.silhouette)};`,
                `-webkit-mask-image: ${url};`,
                `mask-image: ${url};`,
                `-webkit-mask-size: 100% 100%;`,
                `mask-size: 100% 100%;`,
            );
        }
        css += `\n\n${selector} > .${root}__crop > * {\n${inner.map(r => `    ${r}`).join("\n")}\n}`;
    } else {
        const text = layer as TextLayer;
        const textRules = [
            `color: ${cssColor(text.color)};`,
            // cqw = 1% of the container's width, so type scales with the collage.
            `font-size: ${round((text.fontSize / frame.width) * 100, 3)}cqw;`,
            `font-family: ${text.fontFamily};`,
            `font-weight: ${Math.round(text.fontWeight)};`,
            `text-align: ${text.align};`,
            `line-height: 1.15;`,
        ];
        if (text.opacity !== 1) textRules.push(`opacity: ${round(text.opacity, 2)};`);
        css = `${selector} {\n${[...rules, ...textRules].map(r => `    ${r}`).join("\n")}\n}`;
    }

    return css;
}

function interactiveCss(root: string): string {
    return `@media (hover: hover) {
    .${root} figure {
        transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .${root} figure:hover {
        --s: 1.04;
    }
}

@media (prefers-reduced-motion: reduce) {
    .${root} figure {
        transition: none;
    }
}`;
}

function imageMarkup(root: string, index: number, layer: ImageLayer, options: HtmlExportOptions): string {
    const src = options.sources?.[layer.id] ?? layer.src;
    const alt = escapeHtml(layer.label);

    if (layer.style.silhouette) {
        // The source becomes a mask rather than content, so it travels as a
        // custom property. `role="img"` with a label keeps the shape in the
        // accessibility tree, which a decorative <span> would not be.
        return `<figure class="${root}__l${index}" style="--src: url(&quot;${escapeAttr(src)}&quot;)">` +
            `<span class="${root}__crop"><span role="img" aria-label="${alt}"></span></span>` +
            `</figure>`;
    }

    return `<figure class="${root}__l${index}">` +
        `<span class="${root}__crop"><img src="${escapeAttr(src)}" alt="${alt}" loading="lazy" decoding="async"></span>` +
        `</figure>`;
}

function textMarkup(root: string, index: number, layer: TextLayer): string {
    return `<p class="${root}__l${index}">${escapeHtml(layer.text)}</p>`;
}

function pct(fraction: number): string {
    return `${round(fraction * 100, 4)}%`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function escapeAttr(value: string): string {
    return escapeHtml(value);
}

function indent(text: string, spaces: number): string {
    const pad = " ".repeat(spaces);
    return text.split("\n").map(line => (line ? pad + line : line)).join("\n");
}
