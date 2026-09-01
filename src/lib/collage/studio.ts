/**
 * The browser side: loading, cutting out, rendering, saving, and getting the
 * work back out.
 *
 * `tools.ts` deliberately knows none of this. It talks to the `CollageStudio`
 * interface, which means the tools can be tested against a fake studio in node
 * — no canvas, no IndexedDB, no image decoding — while everything that
 * genuinely needs a browser lives here behind one seam.
 */
import {
    Collage,
    type AddFrameSpec, type Frame, type ImageLayer, type Layer, type Rect,
    outputSize, presetCanvasSize, findPreset, unionBounds,
} from "./model.js";
import { arrange as computeLayout, type LayoutMode, type LayoutOptions } from "./layout.js";
import { loadImage, toDataUrl, type LoadedImage } from "./imaging.js";
import { canvasToBlob, previewDataUrl, renderFrame } from "./render.js";
import { exportHtml } from "./exportHtml.js";
import {
    backgroundRemovalError, removeBackground as cutOut, type CutResult, type Progress,
} from "./background.js";
import {
    collectGarbage, clearDoc, clearImages, getImage, loadDoc, newImageKey, putImage, saveDoc,
    type StoredView,
} from "./persistence.js";

export type ExportFormat = "png" | "print" | "html" | "embed";

export interface ExportOptions {
    dpi?: number;
    inlineImages?: boolean;
    interactive?: boolean;
}

export interface ExportOutput {
    summary: string;
    /** Code to hand back to the agent, when it is small enough to be useful. */
    code?: string;
    structured?: object;
}

export interface AddImageOptions {
    label?: string;
    x?: number;
    y?: number;
    width?: number;
    /**
     * Cut the background out before placing it. On by default: a collage is
     * made of cut-outs, and a photo dropped in with its background is almost
     * never what was wanted.
     */
    removeBackground?: boolean;
    onProgress?: (p: Progress) => void;
}

export interface AddImageResult {
    layer: ImageLayer;
    loaded: LoadedImage;
    /** What the background remover did, or why it did nothing. */
    background: CutResult;
}

export interface ArrangeOptions extends LayoutOptions {
    ids?: string[];
}

export interface CollageStudio {
    readonly collage: Collage;
    addImage(url: string, options?: AddImageOptions): Promise<AddImageResult>;
    addFrame(spec: AddFrameSpec, fitContents: boolean): Frame;
    arrange(frameId: string, mode: LayoutMode, options?: ArrangeOptions): number;
    preview(frameId: string, maxSize?: number): Promise<string>;
    exportFrame(frameId: string, format: ExportFormat, options?: ExportOptions): Promise<ExportOutput>;
    /** Re-cut a layer that is already on the canvas. */
    removeBackgroundFor(id: string, onProgress?: (p: Progress) => void): Promise<CutResult>;
    /** Restore the saved collage. Resolves to how many layers came back. */
    restore(): Promise<number>;
    save(view?: StoredView): void;
    clear(): Promise<void>;
    /** The decoded images, for the canvas component to draw with. */
    readonly images: Map<string, LoadedImage>;
}

/** Above this, returning the code in the tool result costs more than it helps. */
const MAX_INLINE_CODE_CHARS = 12000;
/** Margin left around the contents when a frame is fitted to them. */
const FIT_MARGIN = 1.16;
/** Saving on every pointer move would write hundreds of times per drag. */
const SAVE_DEBOUNCE_MS = 600;

export function createStudio(collage = new Collage()): CollageStudio {
    const images = new Map<string, LoadedImage>();
    const objectUrls = new Set<string>();
    let lastView: StoredView | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const trackUrl = (url: string) => {
        objectUrls.add(url);
        return url;
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            saveDoc(collage.list(), collage.listFrames(), lastView);
            // Cheap enough to run alongside a save, and it keeps a long session
            // from leaving every superseded cut-out behind in the store.
            void collectGarbage(collage.list());
        }, SAVE_DEBOUNCE_MS);
    };

    collage.onChanged(scheduleSave);

    const layersOf = (frameId: string): Layer[] => collage.layersIn(frameId);

    const frameOrThrow = (frameId: string): Frame => {
        const frame = collage.getFrame(frameId);
        if (!frame) throw new Error(`There is no frame with id "${frameId}".`);
        return frame;
    };

    /** Bytes for a URL, when we are allowed to have them. */
    const fetchBlob = async (url: string): Promise<Blob | null> => {
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.blob();
        } catch {
            // A remote image without CORS headers. It still displays; we just
            // cannot read or re-cut it.
            return null;
        }
    };

    /** Sources for the HTML export: original URLs, or data URIs when asked. */
    const resolveSources = async (layers: Layer[], inline: boolean): Promise<Record<string, string>> => {
        const sources: Record<string, string> = {};
        for (const layer of layers) {
            if (layer.kind !== "image") continue;
            const loaded = images.get(layer.id);
            if (!loaded) continue;
            // A blob: URL is meaningless outside this tab, so an exported page
            // has to carry the bytes whether or not inlining was asked for.
            const mustInline = inline || layer.src.startsWith("blob:");
            sources[layer.id] = !mustInline || layer.src.startsWith("data:")
                ? layer.src
                : loaded.tainted
                    ? layer.src
                    : await toDataUrl(loaded.image);
        }
        return sources;
    };

    /** Decode, remember, and file the image under a layer id. */
    const adopt = async (layerId: string, src: string): Promise<LoadedImage> => {
        const loaded = await loadImage(src);
        images.set(layerId, loaded);
        return loaded;
    };

    return {
        collage,
        images,

        async addImage(url, options = {}) {
            const wantsCut = options.removeBackground !== false;
            // Load once up front: the coverage tells us whether this is already
            // a cut-out, which is the cheapest possible way to skip the model.
            const original = await loadImage(url);

            let src = url;
            let storageKey: string | null = null;
            let loaded = original;
            let background: CutResult = { ok: false, skipped: true, reason: "Background removal was not requested." };

            const isLocal = url.startsWith("data:") || url.startsWith("blob:");
            const blob = isLocal || wantsCut ? await fetchBlob(url) : null;

            if (wantsCut) {
                background = blob
                    ? await cutOut(blob, { coverage: original.coverage, onProgress: options.onProgress })
                    : { ok: false, reason: "The image's pixels could not be read, so its background was left alone." };
            }

            const keep = background.ok && background.blob ? background.blob : blob;
            if (keep) {
                // Anything we hold the bytes for goes to IndexedDB, so it comes
                // back after a reload. A remote URL that we could not read is
                // left as a plain link — it reloads from its own server.
                storageKey = newImageKey();
                await putImage(storageKey, keep);
                src = trackUrl(URL.createObjectURL(keep));
            }

            const layer = collage.addImage({
                src,
                storageKey,
                label: options.label,
                natural: { width: original.width, height: original.height },
                crop: original.crop,
                x: options.x,
                y: options.y,
                width: options.width,
            });

            loaded = src === url ? original : await adopt(layer.id, src);
            if (src === url) images.set(layer.id, original);
            // The cut-out is a different size and shape from the photo, so the
            // layer has to be re-measured against what it now shows.
            if (src !== url) {
                collage.setSource(layer.id, src, storageKey,
                    { width: loaded.width, height: loaded.height }, loaded.crop);
            }

            return { layer: collage.get(layer.id) as ImageLayer, loaded, background };
        },

        async removeBackgroundFor(id, onProgress) {
            const layer = collage.get(id);
            if (!layer || layer.kind !== "image") return { ok: false, reason: `${id} is not an image layer.` };
            const loaded = images.get(id);
            const blob = await fetchBlob(layer.src);
            if (!blob) return { ok: false, reason: `The pixels of "${layer.label}" could not be read.` };

            // Explicit here, unlike on drop: someone asking for this again has
            // seen the result and wants it run anyway.
            const result = await cutOut(blob, { onProgress });
            if (!result.ok || !result.blob) return result;

            const storageKey = newImageKey();
            await putImage(storageKey, result.blob);
            const src = trackUrl(URL.createObjectURL(result.blob));
            const next = await adopt(id, src);
            collage.setSource(id, src, storageKey, { width: next.width, height: next.height }, next.crop);
            void loaded;
            return result;
        },

        addFrame(spec, fitContents) {
            const frame = collage.addFrame(spec);
            if (!fitContents) return frame;

            const contents = collage.contentBounds();
            if (!contents) {
                // Nothing to wrap yet — centre the frame on the origin so the
                // first images land inside it rather than beside it.
                return collage.updateFrame(frame.id, {
                    x: -frame.width / 2,
                    y: -frame.height / 2,
                })!;
            }
            return collage.updateFrame(frame.id, fitAround(contents, frame.width / frame.height))!;
        },

        arrange(frameId, mode, options = {}) {
            const frame = frameOrThrow(frameId);
            const inside = options.ids?.length
                ? options.ids.map(id => collage.get(id)).filter((l): l is Layer => !!l)
                : layersOf(frameId);
            if (!inside.length) return 0;
            const placements = computeLayout(inside, frame, mode, options);
            for (const placement of placements) {
                collage.update(placement.id, {
                    x: placement.x,
                    y: placement.y,
                    width: placement.width,
                    height: placement.height,
                    rotation: placement.rotation,
                });
            }
            return placements.length;
        },

        async preview(frameId, maxSize = 640) {
            const frame = frameOrThrow(frameId);
            return previewDataUrl(frame, layersOf(frameId), images, maxSize);
        },

        async restore() {
            const doc = loadDoc();
            if (!doc?.layers.length && !doc?.frames.length) return 0;
            lastView = doc.view;

            const restored: Layer[] = [];
            for (const layer of doc.layers) {
                if (layer.kind !== "image") {
                    restored.push(layer);
                    continue;
                }
                if (!layer.storageKey) {
                    // A plain URL — it loads from its own server as before.
                    restored.push(layer);
                    continue;
                }
                const blob = await getImage(layer.storageKey);
                if (!blob) continue; // Bytes are gone; the layer would be a hole.
                restored.push({ ...layer, src: trackUrl(URL.createObjectURL(blob)) });
            }

            collage.restore(restored, doc.frames);
            // Decode in parallel — a dozen images should not be a dozen waits.
            await Promise.all(restored
                .filter((l): l is ImageLayer => l.kind === "image")
                .map(layer => adopt(layer.id, layer.src).catch(() => undefined)));
            return restored.length;
        },

        save(view) {
            if (view) lastView = view;
            scheduleSave();
        },

        async clear() {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = null;
            for (const url of objectUrls) URL.revokeObjectURL(url);
            objectUrls.clear();
            images.clear();
            collage.restore([], []);
            clearDoc();
            await clearImages();
        },

        async exportFrame(frameId, format, options = {}) {
            const frame = frameOrThrow(frameId);
            const layers = layersOf(frameId);
            const dpi = options.dpi ?? 300;

            if (format === "png") {
                const size = outputSize(frame, dpi);
                const canvas = renderFrame(frame, layers, images, { width: size.width, height: size.height });
                const blob = await canvasToBlob(canvas, "image/png");
                const filename = `${slug(frame.name)}.png`;
                download(blob, filename);
                return {
                    summary:
                        `Saved ${filename} — ${size.width}×${size.height}px` +
                        `${frame.physical ? ` (${frame.physical.width}×${frame.physical.height}mm at ${dpi} dpi)` : ""}.`,
                    structured: { filename, width: size.width, height: size.height, bytes: blob.size },
                };
            }

            if (format === "print") {
                const sources = await resolveSources(layers, true);
                const html = printableDocument(frame, layers, sources);
                await printDocument(html);
                return {
                    summary:
                        `Opened the print dialogue for "${frame.name}"` +
                        `${frame.physical ? `, set up as ${frame.physical.width}×${frame.physical.height}mm` : ""}. ` +
                        `Choose "Save as PDF" there for a file. Tell the person the dialogue is waiting for them.`,
                    structured: { printed: true },
                };
            }

            // html and embed differ only in whether the result is a fragment to
            // paste or a whole page to host.
            const asDocument = format === "embed";
            const inline = options.inlineImages ?? asDocument;
            const sources = await resolveSources(layers, inline);
            const code = exportHtml(layers, frame, {
                document: asDocument,
                interactive: options.interactive,
                sources,
                title: frame.name,
            });

            if (code.length <= MAX_INLINE_CODE_CHARS) {
                return {
                    summary: asDocument
                        ? `Here is "${frame.name}" as a complete page. Save it as .html and host it anywhere, ` +
                          `or deploy the folder with \`npx needle-cloud deploy\` to get a URL to <iframe>.`
                        : `Here is "${frame.name}" as a snippet. It is responsive — it fills whatever column it is ` +
                          `dropped into and keeps its proportions.`,
                    code,
                    structured: { chars: code.length, inlineImages: inline },
                };
            }

            // Too big to read, because the images are inside it. Write the file,
            // then try to hand back a link-based version so the agent can still
            // show the person what the markup looks like.
            const filename = `${slug(frame.name)}.html`;
            download(new Blob([code], { type: "text/html" }), filename);
            const linked = exportHtml(layers, frame, {
                document: asDocument,
                interactive: options.interactive,
                sources: await resolveSources(layers, false),
                title: frame.name,
            });
            // Images from a person's own machine have no URL to link to, so
            // there is no smaller version to fall back to. Say that, rather
            // than promising code that is not below.
            const readable = linked.length <= MAX_INLINE_CODE_CHARS;
            return {
                summary:
                    `Saved ${filename} (${Math.round(code.length / 1024)} KB) — the images are embedded in it, ` +
                    `so it needs no hosting. ` +
                    (readable
                        ? `That is too large to show here; below is the same collage with the original image URLs instead.`
                        : `That is too large to show here, and the images have no URLs to link to instead — ` +
                          `they came from files rather than the web. Open the saved file to see the result.`),
                code: readable ? linked : undefined,
                structured: { filename, chars: code.length, inlineImages: true, codeReturned: readable },
            };
        },
    };
}

/**
 * The smallest rect with `aspect` that contains `contents` with a margin.
 * Used when a frame is asked to wrap what is already on the canvas.
 */
export function fitAround(contents: Rect, aspect: number): Rect {
    const width = Math.max(contents.width, contents.height * aspect) * FIT_MARGIN;
    const height = width / aspect;
    return {
        x: contents.x + contents.width / 2 - width / 2,
        y: contents.y + contents.height / 2 - height / 2,
        width,
        height,
    };
}

/**
 * A print document sized to the frame.
 *
 * DOM rather than a rendered bitmap, so text prints as text — vector, crisp at
 * any dpi, and selectable in the resulting PDF. The `@page` size is what makes
 * the browser lay it out as A4 rather than as a screenshot of a web page.
 */
function printableDocument(frame: Frame, layers: Layer[], sources: Record<string, string>): string {
    const page = frame.physical
        ? `${frame.physical.width}mm ${frame.physical.height}mm`
        : `${Math.round(frame.width)}px ${Math.round(frame.height)}px`;
    const body = exportHtml(layers, frame, { sources, className: "collage" });
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeText(frame.name)}</title>
<style>
    @page { size: ${page}; margin: 0; }
    html, body { margin: 0; padding: 0; }
    /* The collage is width-driven and keeps its aspect, so filling the page
       width fills the page. */
    .collage { width: 100%; }
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
</style>
</head><body>
${body}
</body></html>`;
}

/** Print through a hidden iframe so the page itself is never navigated away. */
function printDocument(html: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;";
        iframe.onload = () => {
            // One frame for layout, then print. Images are inlined as data URIs
            // by the caller, so there is nothing left to wait on the network for.
            requestAnimationFrame(() => {
                try {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    // Removing it immediately cancels the dialogue in some
                    // browsers; give the user time to answer it.
                    setTimeout(() => iframe.remove(), 60_000);
                }
            });
        };
        iframe.onerror = () => reject(new Error("The print document could not be prepared."));
        document.body.appendChild(iframe);
        iframe.srcdoc = html;
    });
}

export function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collage";
}

function escapeText(value: string): string {
    return value.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export { unionBounds, presetCanvasSize, findPreset, backgroundRemovalError };
