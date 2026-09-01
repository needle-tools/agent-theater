/**
 * One renderer, three jobs: the on-screen preview, the PNG export, and the
 * small JPEG the agent gets back so it can see what it just made.
 *
 * That last one is the reason this file matters more than it looks. A tool API
 * that only writes is an agent working blind — it places twelve cut-outs and
 * has no idea that four of them landed on top of each other. Rendering the same
 * pixels at 640px and handing them back closes the loop: place, look, adjust.
 *
 * Everything scales from one number — `target.width / frame.width` — so the
 * preview and the 300 dpi print are the same drawing at different sizes, and a
 * layout that looks right in the preview is right on paper.
 */
import { outputSize, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
import type { LoadedImage } from "./imaging.js";

export interface RenderOptions {
    /** Pixel size to draw at. Defaults to the frame's export size. */
    width?: number;
    height?: number;
    /** Draw the frame background. Off gives a transparent PNG. */
    background?: boolean;
}

export type ImageSource = Map<string, LoadedImage>;

export function renderFrame(
    frame: Frame,
    layers: Layer[],
    images: ImageSource,
    options: RenderOptions = {},
): HTMLCanvasElement {
    const natural = outputSize(frame);
    const width = Math.max(1, Math.round(options.width ?? natural.width));
    const height = Math.max(1, Math.round(options.height ?? (width * (frame.height / frame.width))));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context available.");

    if (options.background !== false) {
        ctx.fillStyle = frame.background;
        ctx.fillRect(0, 0, width, height);
    }

    // From here on, draw in canvas units: the frame's top-left is the origin.
    const scale = width / frame.width;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-frame.x, -frame.y);

    for (const layer of [...layers].sort((a, b) => a.z - b.z)) {
        ctx.save();
        // Rotate about the layer's own centre, which is what a person means
        // when they tilt a photo on a table.
        ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.translate(-layer.width / 2, -layer.height / 2);
        if (layer.kind === "image") drawImageLayer(ctx, layer, images.get(layer.id), scale);
        else drawTextLayer(ctx, layer);
        ctx.restore();
    }

    ctx.restore();
    return canvas;
}

function drawImageLayer(
    ctx: CanvasRenderingContext2D,
    layer: ImageLayer,
    loaded: LoadedImage | undefined,
    scale: number,
) {
    if (!loaded) {
        // A layer whose image has not arrived yet gets a placeholder rather
        // than a hole, so a half-loaded preview still reads as a layout.
        ctx.fillStyle = "rgba(34, 44, 32, 0.08)";
        ctx.fillRect(0, 0, layer.width, layer.height);
        return;
    }

    ctx.globalAlpha = layer.style.opacity;

    const { outline, shadow, silhouette } = layer.style;

    // Outline and silhouette both need the shape as its own bitmap; render it
    // once at the size it will actually be drawn and reuse it.
    const needsShape = !!outline || !!silhouette;
    const shape = needsShape
        ? shapeCanvas(loaded, layer, Math.max(1, Math.round(layer.width * scale)), Math.max(1, Math.round(layer.height * scale)))
        : null;

    if (shadow) {
        ctx.save();
        ctx.shadowOffsetX = shadow.x * scale;
        ctx.shadowOffsetY = shadow.y * scale;
        ctx.shadowBlur = shadow.blur * scale;
        ctx.shadowColor = withAlpha(shadow.color, shadow.opacity);
        // The shadow follows the alpha of whatever is drawn, so drawing the
        // shape (not a rectangle) is what makes it a cut-out's shadow.
        if (shape) ctx.drawImage(shape, 0, 0, layer.width, layer.height);
        else drawCropped(ctx, loaded, layer);
        ctx.restore();
    }

    if (outline && outline.width > 0 && shape) {
        const tinted = tint(shape, outline.color);
        // Eight stamps in a ring approximate a stroke around the alpha edge.
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            ctx.drawImage(
                tinted,
                Math.cos(angle) * outline.width,
                Math.sin(angle) * outline.width,
                layer.width,
                layer.height);
        }
    }

    if (silhouette && shape) {
        ctx.drawImage(tint(shape, silhouette), 0, 0, layer.width, layer.height);
    } else {
        drawCropped(ctx, loaded, layer);
    }

    ctx.globalAlpha = 1;
}

/** Draw only the cropped region of the source into the layer's box. */
function drawCropped(ctx: CanvasRenderingContext2D, loaded: LoadedImage, layer: ImageLayer) {
    const { crop } = layer;
    ctx.drawImage(
        loaded.image,
        crop.x * loaded.width,
        crop.y * loaded.height,
        Math.max(1, crop.width * loaded.width),
        Math.max(1, crop.height * loaded.height),
        0, 0, layer.width, layer.height);
}

/** The cropped image on its own transparent canvas, at device pixels. */
function shapeCanvas(loaded: LoadedImage, layer: ImageLayer, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    const { crop } = layer;
    ctx.drawImage(
        loaded.image,
        crop.x * loaded.width,
        crop.y * loaded.height,
        Math.max(1, crop.width * loaded.width),
        Math.max(1, crop.height * loaded.height),
        0, 0, width, height);
    return canvas;
}

/** Flat colour painted through the alpha of a shape canvas. */
function tint(shape: HTMLCanvasElement, color: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = shape.width;
    canvas.height = shape.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(shape, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer) {
    ctx.globalAlpha = layer.opacity;
    ctx.fillStyle = layer.color;
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
    ctx.textBaseline = "top";
    ctx.textAlign = layer.align;
    const x = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
    const lineHeight = layer.fontSize * 1.15;
    let y = 0;
    for (const line of wrap(ctx, layer.text, layer.width)) {
        ctx.fillText(line, x, y);
        y += lineHeight;
    }
    ctx.globalAlpha = 1;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }
    return lines;
}

function withAlpha(color: string, opacity: number): string {
    const alpha = Math.min(1, Math.max(0, opacity));
    if (alpha >= 1) return color;
    // Canvas has no color-mix; go through a scratch context to normalise any
    // CSS colour into rgba we can re-weight.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return color;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A small JPEG of the frame, for handing back to an agent.
 *
 * Capped hard: this string travels through the agent's context, where a
 * full-size PNG would cost more tokens than the entire rest of the
 * conversation. 640px and JPEG quality 0.72 is enough to see a layout and
 * cheap enough to ask for after every change.
 */
export function previewDataUrl(
    frame: Frame,
    layers: Layer[],
    images: ImageSource,
    maxSize = 640,
): string {
    const aspect = frame.width / frame.height;
    const width = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
    const canvas = renderFrame(frame, layers, images, { width });
    return canvas.toDataURL("image/jpeg", 0.72);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => (blob ? resolve(blob) : reject(new Error("The canvas could not be encoded."))),
            type,
            quality);
    });
}
