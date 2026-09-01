/**
 * The WebMCP tools for the collage page.
 *
 * The shape of this API is an argument about how an agent should work with a
 * visual medium. Three things follow from that:
 *
 *  - It can *look*. `collage_preview` hands back an actual picture, so the
 *    agent can see that two cut-outs overlap instead of inferring it from
 *    coordinates. Every mutating tool ends by suggesting a look.
 *  - It does not do arithmetic it cannot check. `collage_arrange` takes a word
 *    ("packed") and does the geometry here, where the frame's real size is
 *    known.
 *  - It is told when the result will be bad. Resolution warnings ride along in
 *    describe and export rather than waiting for someone to print the page.
 *
 * Tool definitions are re-sent on every turn of the conversation, so the
 * descriptions stay terse; detail belongs in the result text, which is only
 * paid for when the tool is actually called.
 */
import { FRAME_PRESETS, outputSize, type Frame, type ImageLayer, type Layer } from "./model.js";
import { LAYOUT_MODES, type LayoutMode } from "./layout.js";
import { checkFrame } from "./quality.js";
import type { CollageStudio, ExportFormat } from "./studio.js";

export interface ToolResult {
    content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
    >;
    structuredContent?: object;
    isError?: boolean;
}

export interface WebMcpToolDef {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    annotations?: object;
    execute: (args: any) => Promise<ToolResult>;
}

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text), ...(structured ? { structuredContent: structured } : {}), isError: true });

export function createCollageTools(studio: CollageStudio): WebMcpToolDef[] {
    const { collage } = studio;

    const describeLayer = (layer: Layer) => {
        const where = `at ${Math.round(layer.x)}, ${Math.round(layer.y)}, ${Math.round(layer.width)}×${Math.round(layer.height)}`;
        if (layer.kind === "text") return `${layer.id} — text "${truncate(layer.text, 40)}", ${where}`;
        const styles = [
            layer.style.silhouette ? `silhouette ${layer.style.silhouette}` : null,
            layer.style.outline ? `outline ${layer.style.outline.width}px` : null,
            layer.style.shadow ? "shadow" : null,
        ].filter(Boolean);
        return `${layer.id} — "${layer.label}" ${where}${styles.length ? `, ${styles.join(", ")}` : ""}`;
    };

    const describeFrame = (frame: Frame) => {
        const size = outputSize(frame);
        const kind = frame.physical
            ? `${frame.physical.width}×${frame.physical.height}mm paper`
            : `${size.width}×${size.height}px`;
        const inside = collage.layersIn(frame.id);
        return `${frame.id} — "${frame.name}" (${kind}), ${inside.length} layer(s) inside`;
    };

    /** Resolve a frame argument, defaulting to the only frame when there is one. */
    const resolveFrame = (id: unknown): { frame: Frame } | { error: ToolResult } => {
        const frames = collage.listFrames();
        if (typeof id === "string" && id) {
            const frame = collage.getFrame(id);
            if (!frame) return { error: fail(`There is no frame with id "${id}". Call collage_describe to see the frames.`) };
            return { frame };
        }
        if (frames.length === 1) return { frame: frames[0] };
        if (!frames.length) {
            return { error: fail(
                `There is no frame yet — a frame is what decides the output size. ` +
                `Call collage_add_frame first, e.g. preset "a4-portrait" or "og-1200x630".`) };
        }
        return { error: fail(
            `There are ${frames.length} frames; pass "frameId" to say which one. ` +
            frames.map(f => `${f.id} ("${f.name}")`).join(", ")) };
    };

    const requireLayer = (id: unknown): { layer: Layer } | { error: ToolResult } => {
        if (typeof id !== "string" || !id) return { error: fail(`Pass the "id" of a layer. Call collage_describe to list them.`) };
        const layer = collage.get(id);
        if (!layer) return { error: fail(`There is no layer with id "${id}". Call collage_describe for what is on the canvas.`) };
        return { layer };
    };

    return [
        {
            name: "collage_describe",
            title: "Describe the collage",
            annotations: { readOnlyHint: true },
            description:
                "List everything on the canvas and every frame, with sizes and any resolution problems. " +
                "Call before changing anything, and call collage_preview to actually see it.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const layers = collage.list();
                const frames = collage.listFrames();
                const quality = frames.map(frame => checkFrame(collage.layersIn(frame.id), frame));
                const warnings = quality.map(q => q.summary).filter(Boolean);

                const parts = [
                    frames.length
                        ? `Frames:\n${frames.map(describeFrame).join("\n")}`
                        : `No frames yet. A frame decides the output size — add one with collage_add_frame.`,
                    layers.length
                        ? `Layers (back to front):\n${layers.map(describeLayer).join("\n")}`
                        : `The canvas is empty. Add cut-outs with collage_add_image.`,
                ];
                if (warnings.length) parts.push(`Resolution:\n${warnings.join("\n")}`);

                return ok(parts.join("\n\n"), {
                    layers,
                    frames,
                    quality,
                    presets: FRAME_PRESETS.map(p => p.id),
                });
            },
        },
        {
            name: "collage_add_image",
            title: "Add an image to the collage",
            description:
                "Put an image on the canvas from an http(s) or data: URL. " +
                "The background is removed automatically — this page cuts it out in the browser, so do NOT " +
                "open FastCut or any other tool first; just pass the original photo. " +
                "An image that is already transparent is left alone. Pass removeBackground: false to keep a " +
                "background on purpose. The result says what happened, and what to do if the cut could not run.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "http(s) or data: URL of the original photo — no need to cut it out first." },
                    label: { type: "string", description: "A name you will recognise later, e.g. 'red sneaker'." },
                    removeBackground: { type: "boolean", description: "Default true. Set false only to keep the background deliberately." },
                    x: { type: "number", description: "Canvas x. Omit to place it automatically." },
                    y: { type: "number", description: "Canvas y." },
                    width: { type: "number", description: "Canvas width. Height follows the aspect ratio." },
                },
                required: ["url"],
            },
            async execute(args: { url?: string; label?: string; removeBackground?: boolean; x?: number; y?: number; width?: number }) {
                const url = str(args?.url);
                if (!url) return fail(`Pass a "url" — http(s) or data:.`);
                if (!/^(https?:|data:image\/)/i.test(url))
                    return fail(`"${truncate(url, 60)}" is not an image URL. Use http(s), or a data:image/… URL.`);
                try {
                    const { layer, loaded, background } = await studio.addImage(url, {
                        label: args?.label,
                        removeBackground: args?.removeBackground,
                        x: args?.x,
                        y: args?.y,
                        width: args?.width,
                    });
                    const cutout = loaded.coverage < 0.95;
                    const notes = [
                        `${loaded.width}×${loaded.height}px`,
                        loaded.colors.length ? `colours ${loaded.colors.slice(0, 3).join(", ")}` : null,
                        loaded.tainted ? "pixels are not readable (served without CORS) — it displays but cannot be exported" : null,
                    ].filter(Boolean);

                    // Say plainly what happened to the background. An agent that
                    // is told the cut failed can route around it; one that is
                    // told nothing ships a collage of photo-shaped rectangles.
                    const cut = background.ok
                        ? "Background removed."
                        : background.skipped
                            ? "It was already a cut-out, so it was left as it is."
                            : `The background was NOT removed — ${background.reason}`;

                    return ok(
                        `Added "${layer.label}" as ${layer.id} — ${notes.join(", ")}. ${cut} ` +
                        (cutout ? `Cropped to its visible shape. ` : "") +
                        `Arrange it with collage_arrange, then look with collage_preview.`,
                        {
                            layer,
                            background: { removed: background.ok, skipped: !!background.skipped, reason: background.reason ?? null },
                            source: { width: loaded.width, height: loaded.height, colors: loaded.colors, cutout, tainted: loaded.tainted },
                        });
                } catch (error) {
                    return fail(`Could not add that image: ${message(error)}`);
                }
            },
        },
        {
            name: "collage_remove_background",
            title: "Cut the background out of a layer",
            description:
                "Re-run background removal on an image already on the canvas — for one that was added with " +
                "removeBackground: false, or whose first cut came out wrong.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", description: "The layer's id." } },
                required: ["id"],
            },
            async execute(args: { id?: string }) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                if (found.layer.kind !== "image") return fail(`${found.layer.id} is text — there is no background to remove.`);
                try {
                    const result = await studio.removeBackgroundFor(found.layer.id);
                    if (!result.ok) return fail(result.reason ?? "The background could not be removed.");
                    const layer = collage.get(found.layer.id);
                    return ok(`Cut the background out of "${found.layer.label}". Look at it with collage_preview.`, { layer });
                } catch (error) {
                    return fail(`Background removal failed: ${message(error)}`);
                }
            },
        },
        {
            name: "collage_add_text",
            title: "Add text to the collage",
            description: "Put a headline or caption on the canvas. It stays real text in the exported HTML.",
            inputSchema: {
                type: "object",
                properties: {
                    text: { type: "string", description: "What it says." },
                    x: { type: "number" },
                    y: { type: "number" },
                    fontSize: { type: "number", description: "In canvas units. Default 48." },
                    color: { type: "string", description: "Any CSS colour." },
                    align: { type: "string", enum: ["left", "center", "right"] },
                    rotation: { type: "number", description: "Degrees of tilt." },
                },
                required: ["text"],
            },
            async execute(args: { text?: string; x?: number; y?: number; fontSize?: number; color?: string; align?: any; rotation?: number }) {
                const text = str(args?.text);
                if (!text) return fail(`Pass some "text".`);
                const layer = collage.addText({
                    text,
                    x: args?.x,
                    y: args?.y,
                    fontSize: args?.fontSize,
                    color: args?.color,
                    align: args?.align,
                    rotation: args?.rotation,
                });
                return ok(`Added text "${truncate(text, 40)}" as ${layer.id}.`, { layer });
            },
        },
        {
            name: "collage_add_frame",
            title: "Add an output frame",
            description:
                "Add a frame — the rectangle that gets exported, and the thing that sets the output size. " +
                `Presets: ${FRAME_PRESETS.map(p => p.id).join(", ")}. ` +
                "By default it wraps everything already on the canvas.",
            inputSchema: {
                type: "object",
                properties: {
                    preset: { type: "string", description: `One of: ${FRAME_PRESETS.map(p => p.id).join(", ")}.` },
                    name: { type: "string" },
                    fitContents: { type: "boolean", description: "Place it around what is already on the canvas. Default true." },
                    background: { type: "string", description: "CSS colour behind the layers. Default white." },
                    widthMm: { type: "number", description: "Custom paper width in mm (with heightMm, instead of a preset)." },
                    heightMm: { type: "number" },
                    widthPx: { type: "number", description: "Custom pixel width (with heightPx, instead of a preset)." },
                    heightPx: { type: "number" },
                },
            },
            async execute(args: any) {
                const presetId = typeof args?.preset === "string" ? args.preset : undefined;
                if (presetId && !FRAME_PRESETS.some(p => p.id === presetId))
                    return fail(`"${presetId}" is not a preset. Use one of: ${FRAME_PRESETS.map(p => p.id).join(", ")}.`);
                const physical = num(args?.widthMm) && num(args?.heightMm)
                    ? { width: args.widthMm, height: args.heightMm, unit: "mm" as const }
                    : undefined;
                const output = num(args?.widthPx) && num(args?.heightPx)
                    ? { width: args.widthPx, height: args.heightPx }
                    : undefined;
                if (!presetId && !physical && !output)
                    return fail(`Pass a "preset", or a custom size as widthMm/heightMm or widthPx/heightPx.`);

                const frame = studio.addFrame({
                    presetId,
                    name: typeof args?.name === "string" ? args.name : undefined,
                    background: typeof args?.background === "string" ? args.background : undefined,
                    physical,
                    output,
                }, args?.fitContents !== false);

                const size = outputSize(frame);
                const inside = collage.layersIn(frame.id);
                return ok(
                    `Added frame ${frame.id} — "${frame.name}", exports at ${size.width}×${size.height}px` +
                    `${frame.physical ? ` (${frame.physical.width}×${frame.physical.height}mm at 300 dpi)` : ""}. ` +
                    `${inside.length} layer(s) fall inside it. Arrange them with collage_arrange.`,
                    { frame, layersInside: inside.length });
            },
        },
        {
            name: "collage_arrange",
            title: "Arrange the collage",
            description:
                `Lay the images out inside a frame: ${LAYOUT_MODES.join(", ")}. ` +
                "Does the geometry for you — every item keeps its aspect ratio and stays inside the frame.",
            inputSchema: {
                type: "object",
                properties: {
                    layout: { type: "string", enum: [...LAYOUT_MODES], description: "How to lay them out." },
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    ids: { type: "array", items: { type: "string" }, description: "Only these layers. Omit for everything in the frame." },
                    padding: { type: "number", description: "Fraction of the frame kept clear at the edges, 0–0.4." },
                    gap: { type: "number", description: "Space between items, 0–0.5." },
                    seed: { type: "number", description: "For 'scatter' — same seed, same result." },
                },
                required: ["layout"],
            },
            async execute(args: { layout?: string; frameId?: string; ids?: string[]; padding?: number; gap?: number; seed?: number }) {
                const mode = LAYOUT_MODES.find(m => m === args?.layout);
                if (!mode) return fail(`"${args?.layout}" is not a layout. Use one of: ${LAYOUT_MODES.join(", ")}.`);
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;

                const count = studio.arrange(resolved.frame.id, mode as LayoutMode, {
                    ids: args?.ids,
                    padding: args?.padding,
                    gap: args?.gap,
                    seed: args?.seed,
                });
                if (!count)
                    return fail(`Nothing to arrange in "${resolved.frame.name}" — add images with collage_add_image first.`);
                return ok(
                    `Arranged ${count} layer(s) in "${resolved.frame.name}" as a ${mode}. Call collage_preview to see it.`,
                    { frameId: resolved.frame.id, layout: mode, count });
            },
        },
        {
            name: "collage_transform",
            title: "Move, resize or rotate a layer",
            description: "Change one layer's position, size, rotation or stacking order, by id.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number", description: "Height follows the aspect ratio." },
                    rotation: { type: "number", description: "Degrees." },
                    order: { type: "string", enum: ["front", "back"], description: "Move it in front of or behind everything." },
                },
                required: ["id"],
            },
            async execute(args: { id?: string; x?: number; y?: number; width?: number; rotation?: number; order?: string }) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                const patch: any = {};
                for (const key of ["x", "y", "width", "rotation"] as const) {
                    if (num((args as any)[key])) patch[key] = (args as any)[key];
                }
                if (!Object.keys(patch).length && !args?.order)
                    return fail(`Nothing to change — pass x, y, width, rotation or order.`);
                let layer = Object.keys(patch).length ? collage.update(found.layer.id, patch) : found.layer;
                if (args?.order === "front") layer = collage.bringToFront(found.layer.id);
                if (args?.order === "back") layer = collage.sendToBack(found.layer.id);
                return ok(`Updated ${describeLayer(layer!)}.`, { layer });
            },
        },
        {
            name: "collage_style",
            title: "Style a cut-out",
            description:
                "Style one image layer using its own transparency: a flat silhouette fill, a sticker outline, " +
                "a drop shadow, or opacity. Pass null to remove one.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    silhouette: { type: ["string", "null"], description: "CSS colour to fill the shape with, or null." },
                    outlineColor: { type: ["string", "null"], description: "Sticker border colour, or null to remove." },
                    outlineWidth: { type: "number", description: "Border width in canvas units. Default 8." },
                    shadow: { type: ["boolean", "null"], description: "Drop shadow following the cut-out's shape." },
                    opacity: { type: "number", description: "0–1." },
                },
                required: ["id"],
            },
            async execute(args: any) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                if (found.layer.kind !== "image") return fail(`${found.layer.id} is text — styling applies to image layers.`);

                const style: any = {};
                if ("silhouette" in args) style.silhouette = typeof args.silhouette === "string" ? args.silhouette : null;
                if ("outlineColor" in args) {
                    style.outline = typeof args.outlineColor === "string"
                        ? { color: args.outlineColor, width: num(args.outlineWidth) ? args.outlineWidth : 8 }
                        : null;
                } else if (num(args?.outlineWidth) && (found.layer as ImageLayer).style.outline) {
                    style.outline = { ...(found.layer as ImageLayer).style.outline!, width: args.outlineWidth };
                }
                if ("shadow" in args) {
                    style.shadow = args.shadow
                        ? { x: 0, y: 10, blur: 22, color: "#222C20", opacity: 0.32 }
                        : null;
                }
                if (num(args?.opacity)) style.opacity = Math.min(1, Math.max(0, args.opacity));
                if (!Object.keys(style).length)
                    return fail(`Nothing to change — pass silhouette, outlineColor, shadow or opacity.`);

                const layer = collage.update(found.layer.id, { style });
                return ok(`Styled ${describeLayer(layer!)}.`, { layer });
            },
        },
        {
            name: "collage_remove",
            title: "Remove a layer or frame",
            annotations: { destructiveHint: true },
            description: "Take one layer or frame off the canvas, by id.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
            async execute(args: { id?: string }) {
                const id = args?.id;
                if (typeof id !== "string" || !id) return fail(`Pass the "id" of a layer or frame.`);
                const frame = collage.getFrame(id);
                if (frame) {
                    collage.removeFrame(id);
                    return ok(`Removed the frame "${frame.name}". The layers it covered are still on the canvas.`, { frame });
                }
                const layer = collage.remove(id);
                if (!layer) return fail(`There is nothing with id "${id}". Call collage_describe.`);
                return ok(`Removed "${layer.label}".`, { layer });
            },
        },
        {
            name: "collage_preview",
            title: "Look at the collage",
            annotations: { readOnlyHint: true },
            description:
                "Render a frame and return it as an image, so you can see what you made and fix what is wrong. " +
                "Call this after arranging or styling.",
            inputSchema: {
                type: "object",
                properties: {
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    maxSize: { type: "number", description: "Longest edge in pixels, 240–1024. Default 640." },
                },
            },
            async execute(args: { frameId?: string; maxSize?: number }) {
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;
                const maxSize = Math.min(1024, Math.max(240, Math.round(args?.maxSize ?? 640)));
                try {
                    const dataUrl = await studio.preview(resolved.frame.id, maxSize);
                    const [, mimeType = "image/jpeg", data = ""] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
                    if (!data) return fail(`The preview could not be encoded.`);
                    const quality = checkFrame(collage.layersIn(resolved.frame.id), resolved.frame);
                    return {
                        content: [
                            { type: "image", data, mimeType },
                            {
                                type: "text",
                                text: `"${resolved.frame.name}" with ${collage.layersIn(resolved.frame.id).length} layer(s).` +
                                    (quality.summary ? `\n\n${quality.summary}` : ""),
                            },
                        ],
                        structuredContent: { frameId: resolved.frame.id, quality },
                    };
                } catch (error) {
                    return fail(`Could not render the preview: ${message(error)}`);
                }
            },
        },
        {
            name: "collage_export",
            title: "Export the collage",
            description:
                "Export a frame. 'png' downloads an image, 'print' opens the print dialogue (Save as PDF for paper), " +
                "'html' returns a self-contained snippet to paste into a website, 'embed' returns a full page to host.",
            inputSchema: {
                type: "object",
                properties: {
                    format: { type: "string", enum: ["png", "print", "html", "embed"], description: "What to produce." },
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    dpi: { type: "number", description: "For png/print on paper frames. 72–600, default 300." },
                    inlineImages: { type: "boolean", description: "For html/embed: embed the images in the code so it needs no hosting." },
                    interactive: { type: "boolean", description: "For html/embed: add a subtle hover lift to each cut-out." },
                },
                required: ["format"],
            },
            async execute(args: { format?: string; frameId?: string; dpi?: number; inlineImages?: boolean; interactive?: boolean }) {
                const format = (["png", "print", "html", "embed"] as const).find(f => f === args?.format);
                if (!format) return fail(`"${args?.format}" is not a format. Use png, print, html or embed.`);
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;
                const frame = resolved.frame;
                const dpi = Math.min(600, Math.max(72, Math.round(args?.dpi ?? 300)));

                const quality = checkFrame(collage.layersIn(frame.id), frame, dpi);
                try {
                    const output = await studio.exportFrame(frame.id, format as ExportFormat, {
                        dpi,
                        inlineImages: args?.inlineImages,
                        interactive: args?.interactive,
                    });
                    const warning = quality.summary ? `\n\nHeads up: ${quality.summary}` : "";
                    return ok(`${output.summary}${warning}${output.code ? `\n\n${output.code}` : ""}`, {
                        frameId: frame.id,
                        format,
                        ...output.structured,
                        quality,
                    });
                } catch (error) {
                    return fail(`Export failed: ${message(error)}`);
                }
            },
        },
    ];
}

function num(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Arguments arrive as whatever the model decided to send. A number where a
 * string was declared is a routine mistake, and it must come back as a sentence
 * the agent can act on — never as a TypeError thrown at the browser.
 */
function str(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
