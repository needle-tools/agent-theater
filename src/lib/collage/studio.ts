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
    Collage, bounds, overlaps,
    type AddFrameSpec, type Frame, type ImageLayer, type Layer, type Rect,
    outputSize, presetCanvasSize, findPreset, unionBounds,
} from "./model.js";
import { arrange as computeLayout, type LayoutMode, type LayoutOptions } from "./layout.js";
import { loadImage, toDataUrl, type LoadedImage } from "./imaging.js";
import { canvasToBlob, previewDataUrl, renderFrame, renderRegion } from "./render.js";
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
    /** Who is doing this, for the event log a watching agent reads. */
    by?: "human" | "agent";
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

export interface CaptureOptions {
    /** Capture exactly these layers. Defaults to the selection, then the page. */
    ids?: string[];
    /** Capture an explicit rectangle in canvas units. Wins over `ids`. */
    region?: Rect;
    /** Longest edge in pixels. */
    maxSize?: number;
    /** Colour behind the layers, or null for transparency. */
    background?: string | null;
    /** Room left around the captured layers, as a fraction. */
    padding?: number;
}

export interface CaptureResult {
    /** A data: URL — `image/png` when transparent, `image/jpeg` otherwise. */
    dataUrl: string;
    /** What was actually captured, so a result can be dropped back in its place. */
    region: Rect;
    /** Layers that fell inside it. */
    ids: string[];
    width: number;
    height: number;
}

/** Something that happened, for anyone watching. */
export interface CollageEvent {
    /** Monotonic. A watcher passes the last one it saw to avoid missing any. */
    seq: number;
    at: number;
    kind:
        | "image-added" | "text-added" | "layer-moved" | "layer-styled" | "layer-removed"
        | "arranged" | "page-changed" | "exported" | "cleared";
    /** One line, already phrased for an agent to read. */
    summary: string;
    /** Whether a person did it or an agent did. */
    by: "human" | "agent";
    detail?: object;
}

export interface CollageStudio {
    readonly collage: Collage;
    addImage(url: string, options?: AddImageOptions): Promise<AddImageResult>;
    addFrame(spec: AddFrameSpec, fitContents: boolean): Frame;
    /**
     * The single output page. Frames are an export setting here, not objects on
     * the canvas — there is at most one, and the canvas never asks anyone to
     * manage it.
     */
    setPage(presetId: string, background?: string): Frame;
    /** Paint something behind the layers, or "transparent" for nothing. */
    setPageBackground(background: string): Frame | null;
    readonly page: Frame | null;
    readonly pagePreset: string;
    /** Re-fit a free-form page around whatever is on the canvas now. */
    refitPage(): void;
    /**
     * What is picked out right now.
     *
     * Selection lives here rather than in the canvas component because both
     * sides need it: a person shift-clicks three cut-outs, an agent captures
     * exactly those three and drops a generated image back in their place.
     */
    readonly selection: string[];
    setSelection(ids: string[]): void;
    onSelectionChanged(callback: () => void): () => void;
    /** Bounds of the selection, of some ids, or null when nothing is picked. */
    selectionBounds(ids?: string[]): Rect | null;
    /** An image of part of the canvas, for handing to something that makes pictures. */
    capture(options?: CaptureOptions): Promise<CaptureResult>;
    /** Note something that happened, for watchers. */
    record(kind: CollageEvent["kind"], summary: string, by?: "human" | "agent", detail?: object): void;
    /** Everything since `seq`. */
    eventsSince(seq: number): CollageEvent[];
    /** Resolves as soon as anything happens after `seq`, or empty on timeout. */
    waitForEvents(seq: number, timeoutMs: number, signal?: AbortSignal): Promise<CollageEvent[]>;
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
/** A watcher only ever needs recent history; older events are not worth holding. */
const MAX_EVENTS = 200;
/** The page id meaning "no fixed size — whatever is on the canvas". */
export const FREE_PAGE = "free";
/** Breathing room left around the contents when a free page is fitted. */
const FREE_PAGE_MARGIN = 1.08;

export function createStudio(collage = new Collage()): CollageStudio {
    const images = new Map<string, LoadedImage>();
    const objectUrls = new Set<string>();
    let lastView: StoredView | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const events: CollageEvent[] = [];
    const waiters = new Set<() => void>();
    let sequence = 0;
    let pagePreset = FREE_PAGE;

    let selection: string[] = [];
    const selectionWatchers = new Set<() => void>();

    const record = (
        kind: CollageEvent["kind"],
        summary: string,
        by: "human" | "agent" = "human",
        detail?: object,
    ) => {
        events.push({ seq: ++sequence, at: Date.now(), kind, summary, by, ...(detail ? { detail } : {}) });
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        // Wake every watcher; each re-reads from its own cursor.
        for (const wake of [...waiters]) wake();
    };

    /** The one page, if there is one. */
    const pageFrame = (): Frame | null => collage.listFrames()[0] ?? null;

    /** A free page is just the contents with a little air around them. */
    const freePageRect = (): Rect => {
        const contents = collage.contentBounds();
        if (!contents) return { x: -400, y: -300, width: 800, height: 600 };
        const width = Math.max(200, contents.width * FREE_PAGE_MARGIN);
        const height = Math.max(200, contents.height * FREE_PAGE_MARGIN);
        return {
            x: contents.x + contents.width / 2 - width / 2,
            y: contents.y + contents.height / 2 - height / 2,
            width,
            height,
        };
    };

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

        get page() {
            return pageFrame();
        },

        get pagePreset() {
            return pagePreset;
        },

        /**
         * Point the output at a page size.
         *
         * There is always at most one frame and the canvas never shows it as
         * something to manage — two overlapping sheets of paper that could not
         * be deleted was the whole problem with treating them as objects.
         */
        setPage(presetId, background) {
            pagePreset = presetId;
            // Start from none: a page carries its physical size and output
            // pixels, which a resize cannot change, so switching means
            // replacing. Anything beyond the first is left over from when
            // frames were objects on the canvas.
            for (const frame of collage.listFrames()) collage.removeFrame(frame.id);

            if (presetId === FREE_PAGE) {
                // A free canvas of cut-outs almost always wants nothing behind
                // it; paper, below, is paper-coloured.
                const frame = collage.addFrame({
                    name: "Canvas",
                    background: background ?? "transparent",
                    ...freePageRect(),
                });
                record("page-changed", "The output now follows whatever is on the canvas.");
                return frame;
            }

            const preset = findPreset(presetId);
            const size = preset ? presetCanvasSize(preset) : { width: 800, height: 600 };
            // Centre it on the work, rather than making the view jump to the origin.
            const contents = collage.contentBounds();
            const centerX = contents ? contents.x + contents.width / 2 : 0;
            const centerY = contents ? contents.y + contents.height / 2 : 0;
            const frame = collage.addFrame({
                presetId,
                background: background ?? "#FFFFFF",
                x: centerX - size.width / 2,
                y: centerY - size.height / 2,
                width: size.width,
                height: size.height,
            });
            record("page-changed", `The output is now ${preset?.name ?? presetId}.`);
            return frame;
        },

        setPageBackground(background) {
            const frame = pageFrame();
            if (!frame) return null;
            const next = collage.updateFrame(frame.id, { background });
            record("page-changed", background === "transparent"
                ? "The page background is now transparent."
                : `The page background is now ${background}.`);
            return next;
        },

        refitPage() {
            if (pagePreset !== FREE_PAGE) return;
            const frame = pageFrame();
            if (frame) collage.updateFrame(frame.id, freePageRect());
        },

        get selection() {
            return selection;
        },

        setSelection(ids) {
            // Only ids that still exist, de-duplicated, in canvas order — so a
            // capture of "these three" is stable however they were clicked.
            const live = new Set(collage.list().map(l => l.id));
            const unique = [...new Set(ids)].filter(id => live.has(id));
            const same = unique.length === selection.length && unique.every((id, i) => id === selection[i]);
            if (same) return;
            selection = unique;
            for (const watcher of [...selectionWatchers]) watcher();
        },

        onSelectionChanged(callback) {
            selectionWatchers.add(callback);
            return () => { selectionWatchers.delete(callback); };
        },

        selectionBounds(ids) {
            const chosen = ids?.length ? ids : selection;
            if (!chosen.length) return null;
            return collage.contentBounds(chosen);
        },

        async capture(options = {}) {
            const padding = options.padding ?? 0.04;
            const ids = options.ids?.length ? options.ids : selection;

            // An explicit rectangle wins; then the chosen layers; then the page,
            // which is the sensible "capture what I am looking at".
            let region = options.region ?? collage.contentBounds(ids.length ? ids : undefined);
            if (!options.region && region) {
                const growX = region.width * padding;
                const growY = region.height * padding;
                region = {
                    x: region.x - growX,
                    y: region.y - growY,
                    width: region.width + growX * 2,
                    height: region.height + growY * 2,
                };
            }
            if (!region) {
                this.refitPage();
                const page = pageFrame();
                if (!page) throw new Error("There is nothing on the canvas to capture.");
                region = { x: page.x, y: page.y, width: page.width, height: page.height };
            }

            const maxSize = Math.min(2048, Math.max(64, Math.round(options.maxSize ?? 768)));
            const scale = maxSize / Math.max(region.width, region.height);
            const width = Math.max(1, Math.round(region.width * scale));
            const height = Math.max(1, Math.round(region.height * scale));

            const page = pageFrame();
            const background = options.background === undefined
                ? (page && page.background !== "transparent" ? page.background : null)
                : options.background;

            const inside = collage.list().filter(layer => overlaps(bounds(layer), region!));
            const canvas = renderRegion(region, inside, images, { width, height, background });
            // Transparency has to survive, so PNG whenever there is any.
            const dataUrl = background
                ? canvas.toDataURL("image/jpeg", 0.82)
                : canvas.toDataURL("image/png");

            return { dataUrl, region, ids: inside.map(l => l.id), width, height };
        },

        record,

        eventsSince(seq) {
            return events.filter(event => event.seq > seq);
        },

        waitForEvents(seq, timeoutMs, signal) {
            const ready = events.filter(event => event.seq > seq);
            if (ready.length) return Promise.resolve(ready);
            if (signal?.aborted) return Promise.resolve([]);

            return new Promise(resolve => {
                const finish = (result: CollageEvent[]) => {
                    waiters.delete(wake);
                    clearTimeout(timer);
                    signal?.removeEventListener("abort", onAbort);
                    resolve(result);
                };
                const wake = () => finish(events.filter(event => event.seq > seq));
                // Returning empty rather than hanging: an agent's tool call has
                // its own timeout, and "nothing happened, ask again" is a much
                // better answer than a call that never comes back.
                const timer = setTimeout(() => finish([]), timeoutMs);
                const onAbort = () => finish([]);
                signal?.addEventListener("abort", onAbort, { once: true });
                waiters.add(wake);
            });
        },

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

            record(
                "image-added",
                `"${layer.label}" was added${background.ok ? " and its background removed" : ""}.`,
                options.by ?? "human",
                { id: layer.id, label: layer.label, backgroundRemoved: background.ok });
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
            // A free page has no size of its own; catch it up before asking
            // what it contains, or it answers with a rect from before the
            // pictures arrived.
            this.refitPage();
            const frame = frameOrThrow(frameId);
            const inside = options.ids?.length
                ? options.ids.map(id => collage.get(id)).filter((l): l is Layer => !!l)
                // Nothing on the page means the page is somewhere else — a
                // fixed size sitting where the work is not. Laying everything
                // out brings it onto the page, which is what was being asked
                // for. Doing nothing at all, silently, is never the answer.
                : layersOf(frameId).length ? layersOf(frameId) : collage.list();
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
            record("arranged", `${placements.length} layers were arranged as a ${mode}.`, "human", { mode, count: placements.length });
            // The page follows the work, so a free page has to catch up again
            // now that the work has moved.
            this.refitPage();
            return placements.length;
        },

        async preview(frameId, maxSize = 640) {
            // A free page has no size of its own, so it is re-fitted to the
            // contents at the moment anyone asks to see it.
            this.refitPage();
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

            // Sessions saved when frames were canvas objects can hold several.
            // There is no interface for a second one any more, so the first
            // becomes the page and the rest are dropped.
            const frames = doc.frames.slice(0, 1);
            pagePreset = frames[0]?.presetId ?? FREE_PAGE;
            collage.restore(restored, frames);
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
            pagePreset = FREE_PAGE;
            clearDoc();
            await clearImages();
            record("cleared", "The canvas was cleared.");
        },

        async exportFrame(frameId, format, options = {}) {
            this.refitPage();
            const frame = frameOrThrow(frameId);
            const layers = layersOf(frameId);
            const dpi = options.dpi ?? 300;
            record("exported", `Exported "${frame.name}" as ${format}.`, "human", { format });

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
                const printed = await printDocument(html);
                if (printed) {
                    return {
                        summary:
                            `Opened the print dialogue for "${frame.name}"` +
                            `${frame.physical ? `, set up as ${frame.physical.width}×${frame.physical.height}mm` : ""}. ` +
                            `Choose "Save as PDF" there for a file. Tell the person the dialogue is waiting for them.`,
                        structured: { printed: true },
                    };
                }

                // Embedded browsers — an app's in-app web view — routinely have
                // no print at all. Producing the page as a print-resolution
                // image is a worse answer than a PDF but a much better one than
                // a button that does nothing.
                const size = outputSize(frame, dpi);
                const canvas = renderFrame(frame, layers, images, { width: size.width, height: size.height });
                const blob = await canvasToBlob(canvas, "image/png");
                const filename = `${slug(frame.name)}-print.png`;
                download(blob, filename);
                return {
                    summary:
                        `This browser will not open a print dialogue — in-app browsers usually cannot. ` +
                        `Saved ${filename} instead at ${size.width}×${size.height}px (${dpi} dpi` +
                        `${frame.physical ? `, ${frame.physical.width}×${frame.physical.height}mm` : ""}), ` +
                        `which prints correctly from anywhere that can open an image.`,
                    structured: { printed: false, filename, width: size.width, height: size.height },
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
