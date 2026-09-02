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
    outputSize, presetCanvasSize, findPreset, unionBounds, type Stage,
} from "./model.js";
import { arrange as computeLayout, type LayoutMode, type LayoutOptions } from "./layout.js";
import { loadImage, readPixels, toDataUrl, type LoadedImage } from "./imaging.js";
import { canvasToBlob, previewDataUrl, renderFrame, renderRegion } from "./render.js";
import { fontsReady, loadWebFonts, webFontsUsed } from "./webfonts.js";
import { shapeFromMask, type Shape } from "./silhouette.js";
import { svgBlob, traceToSvg as traceToSvgPixels, TRACE_EDGE, type TraceOptions } from "./trace.js";
import { exportHtml } from "./exportHtml.js";
import {
    backgroundRemovalError, removeBackground as cutOut,
    type CutRegion, type CutResult, type Progress,
} from "./background.js";
import {
    collectGarbage, clearDoc, clearImages, getImage, loadDoc, newImageKey, putImage, saveDoc,
    type StoredDoc, type StoredView,
} from "./persistence.js";
import { packCollage, readCollage, type CollageAsset } from "./collageFile.js";
import { plan as planScene, type Plan } from "./perform.js";
import { DEFAULT_HOLD, sceneBeats, type ShowTiming } from "./show.js";
import { SILENT, type Speaker } from "./audio.js";

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
    /** Place it here rather than on the automatic spiral. */
    near?: { x: number; y: number };
    /**
     * Cut the background out before placing it. On by default: a collage is
     * made of cut-outs, and a photo dropped in with its background is almost
     * never what was wanted.
     */
    removeBackground?: boolean;
    /**
     * Split a photo that holds several objects into one layer each. On by
     * default, for the same reason background removal is: a picture of five
     * stickers on a desk was dropped in to get five stickers.
     */
    slice?: boolean;
    /**
     * Also place the scene with its objects painted out, behind them.
     *
     * Off by default. It costs a second model of about 28 MB and a slow pass,
     * which is not a price to charge every drop — but for one photo of things
     * on a surface it turns a flat picture into a background and a set of
     * things that can be moved around on it.
     */
    heal?: boolean;
    /**
     * Where the subjects are, as fractions of the image, for a picture whose
     * parts touch. Without these, only things separated by transparency can be
     * told apart — which in a generated poster is usually none of them.
     */
    regions?: CutRegion[];
    onProgress?: (p: Progress) => void;
    /** Who is doing this, for the event log a watching agent reads. */
    by?: "human" | "agent";
}

export interface TraceOutcome {
    ok: boolean;
    /** How many filled shapes it came out as. */
    paths?: number;
    bytes?: number;
    /** Why nothing happened, phrased for a person or an agent to read. */
    reason?: string;
}

export interface AddImageResult {
    layer: ImageLayer;
    loaded: LoadedImage;
    /**
     * Every layer that was added. One for an ordinary photo; several when it
     * turned out to hold several objects, in which case `layer` is the first.
     */
    pieces?: ImageLayer[];
    /** What the background remover did, or why it did nothing. */
    background: CutResult;
}

export interface ArrangeOptions extends LayoutOptions {
    ids?: string[];
    /**
     * Also scale each layer to the size the layout picked. Off by default: the
     * layouts size things to fill the page, so leaving it on made everything
     * shrink a little more on every arrange.
     */
    resize?: boolean;
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
        | "image-added" | "text-added" | "layer-moved" | "layer-styled" | "layer-removed" | "opened"
        | "arranged" | "page-changed" | "exported" | "cleared"
        /**
         * Something slow is still going. Its own kind because a watcher wants
         * to tell "nothing has happened" apart from "something is happening and
         * has not finished" — the first means try again, the second means wait.
         */
        | "working";
    /** One line, already phrased for an agent to read. */
    summary: string;
    /** Whether a person did it or an agent did. */
    by: "human" | "agent";
    detail?: object;
}

export interface CollageStudio {
    readonly collage: Collage;
    addImage(url: string, options?: AddImageOptions): Promise<AddImageResult>;
    /**
     * Place the separate objects a photo turned out to contain. Called by
     * addImage; exposed because it is the whole of the multi-piece path.
     */
    addPieces(cut: CutResult, original: LoadedImage, options: AddImageOptions): Promise<AddImageResult>;
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
     * Told when something is about to move that nobody is dragging.
     *
     * The view eases those, and only those. A person dragging a layer must have
     * it follow the pointer exactly — easing a drag is the classic way a canvas
     * starts feeling broken — but a layer that jumps because an agent moved it
     * has no such excuse, and a jump gives no clue as to what changed. So: hand
     * moves are instant, everything else settles.
     */
    onSettle(callback: () => void): () => void;
    /** Announce such a move. Call before mutating, so the view can prepare. */
    settle(): void;
    /**
     * Play a scene. Resolves when the last beat finishes.
     *
     * The canvas registers itself as the performer; without one this is a no-op
     * that still commits where things end up, so the tools behave the same in a
     * test as in a browser.
     */
    playScene(plan: Plan): Promise<void>;
    setPerformer(performer: ((plan: Plan) => Promise<void>) | null): void;
    /** The canvas hands back a way to abandon what it is playing. */
    setStopper(stop: (() => void) | null): void;
    /** And a way to make a noise. Silent until the canvas has mounted. */
    setSpeaker(speaker: Speaker | null): void;
    readonly speaker: Speaker;
    /** Abandon whatever is playing. */
    stopScene(): void;
    /**
     * Run the scenes one after another: build-up, script, hand-off, next.
     *
     * Returns the timings straight away and keeps playing, because the point of
     * a show is that somebody narrates over it — a call that blocked for the
     * length of the play would be the one thing the agent could not talk during.
     */
    playShow(stageIds?: string[]): { timings: ShowTiming[]; duration: number };
    stopShow(): void;
    /** The scene the show is on, or null when nothing is running. */
    readonly showing: string | null;
    /** True while a score is playing, so a second one can be refused. */
    readonly performing: boolean;
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
    /**
     * Replace a layer's pixels with traced vector shapes. Crisp at any size,
     * and a flat-colour look a photograph cannot give.
     */
    traceToSvg(id: string, options?: TraceOptions): Promise<TraceOutcome>;
    /** Restore the saved collage. Resolves to how many layers came back. */
    restore(): Promise<number>;
    /** The whole collage as one openable picture. */
    saveFile(): Promise<{ blob: Blob; filename: string }>;
    /**
     * Open a collage file onto the canvas, alongside whatever is already there.
     * Resolves to how many layers arrived, or 0 if the file holds no collage.
     */
    openFile(file: Blob): Promise<number>;
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

/**
 * A page id anyone can act on, or the free canvas.
 *
 * Sessions saved before the free page carried an id hold "custom", and a
 * collage file can name a preset this build has since dropped. Either way the
 * value reaches a picker with no such option and the control goes blank, which
 * reads as broken and cannot be put right by using it.
 */
function knownPage(presetId: string | undefined): string {
    if (!presetId) return FREE_PAGE;
    return presetId === FREE_PAGE || findPreset(presetId) ? presetId : FREE_PAGE;
}

/** Is the inner rectangle wholly within the outer one? */
function contains(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

/** Said out loud, because a crop nobody was told about reads as a bug. */
function cropNote(overflowing: number): string {
    if (!overflowing) return "";
    return ` ${overflowing} ${overflowing === 1 ? "item reaches" : "items reach"} past the page edge and ` +
        `${overflowing === 1 ? "was" : "were"} cropped — arrange the collage, or switch to the free canvas, to keep everything.`;
}

/**
 * Which layers a capture actually draws.
 *
 * Asking for layers and asking for a rectangle are different questions.
 * "Capture this sticker" must give back the sticker — not the sticker plus the
 * headline it sits under and the plant behind it, which is what happens if the
 * chosen layers are only used to *derive* a rectangle and then everything
 * overlapping that rectangle gets drawn. A rectangle, on the other hand, means
 * exactly "whatever is in frame", so overlap is the right rule there.
 *
 * The region is grown from the chosen layers either way, so a generated image
 * still drops back into the same place.
 *
 * Exported because this is the whole decision, and it is worth testing without
 * a canvas to draw on.
 */
export function capturedLayers(
    all: readonly Layer[],
    region: Rect,
    ids: readonly string[],
    explicitRegion: boolean,
): Layer[] {
    if (!explicitRegion && ids.length) {
        const wanted = new Set(ids);
        return all.filter(layer => wanted.has(layer.id));
    }
    return all.filter(layer => overlaps(bounds(layer), region));
}

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
    const settleWatchers = new Set<() => void>();
    let performer: ((plan: Plan) => Promise<void>) | null = null;
    let stopPerformance: (() => void) | null = null;
    let acting = false;
    /** The scene the show is on, and whether it should still be going. */
    let running: string | null = null;
    let wanted = false;
    let speaker: Speaker = SILENT;

    /**
     * The show itself.
     *
     * Each scene is: put the arrivals where they come in from, play the whole
     * thing as one plan, hold, then move on. Stopping is checked between every
     * step rather than only between scenes — a show that ignored the request
     * until the current scene ended would ignore it for half a minute.
     */
    const runShow = async (stages: Stage[]) => {
        wanted = true;
        for (const stage of stages) {
            if (!wanted) break;
            running = stage.id;
            collage.setActiveStage(stage.id);
            // Started with the scene rather than with its first beat, so the
            // bed is already under the build-up. Cross-fading is the speaker's
            // business; from here it is just "this scene wants this".
            speaker.music(stage.music ?? null);

            const { approach, beats } = sceneBeats(stage, id => collage.get(id)?.height ?? 100);
            // Arrivals start off stage. Done through the placement, so the
            // walk that brings them on commits back to exactly where the stage
            // says they stand — no drift, however many times the show runs.
            if (approach.length) {
                collage.batch(() => {
                    for (const step of approach) {
                        const layer = collage.get(step.id);
                        if (layer) collage.update(step.id, { x: layer.x + step.dx, y: layer.y + step.dy });
                    }
                });
            }

            const { plan } = planScene(beats);
            if (plan.beats.length) await studio.playScene(plan);
            if (!wanted) break;
            await new Promise(resolve => setTimeout(resolve, (stage.hold ?? DEFAULT_HOLD) * 1000));
        }
        running = null;
        wanted = false;
        speaker.music(null);
    };
    const announceSettle = () => { for (const watcher of [...settleWatchers]) watcher(); };

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
            saveDoc(collage.listAll(), collage.listFrames(), lastView, collage.listStages());
            // Cheap enough to run alongside a save, and it keeps a long session
            // from leaving every superseded cut-out behind in the store.
            // listAll, emphatically. With a stage showing, list() answers with
            // that stage's cast — and collecting against it would delete the
            // stored bytes of every layer in every OTHER scene.
            void collectGarbage(collage.listAll());
        }, SAVE_DEBOUNCE_MS);
    };

    collage.onChanged(scheduleSave);

    // Whoever put a fetched face on the canvas — the font menu, an agent
    // calling collage_style, a reloaded session, a paste — the stylesheet has
    // to be on the page or the text draws in the fallback. Watching the model
    // catches all of those in one place instead of one call site at a time.
    let webFontsLinked = false;
    collage.onChanged(() => {
        if (webFontsLinked || !webFontsUsed(collage.listAll()).length) return;
        webFontsLinked = true;
        void loadWebFonts();
    });

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

    /**
     * The shape of each layer that has one.
     *
     * Only images, and only those whose pixels could actually be read: a
     * cross-origin photo taints the canvas, so it has no mask and packs as its
     * box. Text has no silhouette worth nesting into either.
     *
     * Built once per arrange rather than once per packing attempt — the search
     * repacks a dozen times looking for a scale, and the shape does not change
     * with the scale.
     */
    const silhouettesOf = (layers: Layer[]): Map<string, Shape> => {
        const shapes = new Map<string, Shape>();
        for (const layer of layers) {
            if (layer.kind !== "image") continue;
            const mask = images.get(layer.id)?.mask;
            if (mask) shapes.set(layer.id, shapeFromMask(mask, layer.crop));
        }
        return shapes;
    };

    /** Decode, remember, and file the image under a layer id. */
    const adopt = async (layerId: string, src: string): Promise<LoadedImage> => {
        const loaded = await loadImage(src);
        images.set(layerId, loaded);
        return loaded;
    };

    const studio: CollageStudio = {
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
                    // Named, and not left to default to "custom". The preset id
                    // on the frame is the only record of which page was chosen
                    // — restore reads it straight back — so an unnamed free
                    // page came back as a page nothing recognised.
                    presetId: FREE_PAGE,
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

            const inside = capturedLayers(collage.list(), region, ids, !!options.region);

            await fontsReady(inside);
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
                // Said out loud, because the first cut on a cold cache pulls
                // tens of megabytes of model and anything watching needs to
                // know the difference between slow and stuck.
                record("working", `Cutting out "${options.label ?? "an image"}"…`, options.by ?? "human");
                let announced = 0;
                background = blob
                    ? await cutOut(blob, {
                        coverage: original.coverage,
                        onProgress: (progress: Progress) => {
                            options.onProgress?.(progress);
                            // Every quarter, not every tick: the loader reports
                            // thousands of times and the log holds 200 events.
                            if (!progress.total) return;
                            const done = Math.floor(((progress.loaded ?? 0) / progress.total) * 4);
                            if (done <= announced) return;
                            announced = done;
                            record("working",
                                `Fetching the background remover — ${done * 25}%. ` +
                                `First use downloads the model; later ones are quick.`,
                                options.by ?? "human");
                        },
                        // A photo of five stickers on a desk is five things, and
                        // one image of all five is not what anyone dropped it in
                        // for. The size goes along because "big enough to be an
                        // object" is a fraction of the image, not a fixed count.
                        slice: options.slice !== false,
                        heal: options.heal === true,
                        regions: options.regions,
                        size: { width: original.width, height: original.height },
                    })
                    : { ok: false, reason: "The image's pixels could not be read, so its background was left alone." };
            }

            // Several objects, or one object plus the scene behind it: both
            // arrive as pieces, and both are placed the same way.
            if (background.pieces?.length && background.source) {
                return this.addPieces(background, original, options);
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
                near: options.near,
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

        /**
         * Add each object a photo turned out to contain, as its own layer.
         *
         * Laid out as they were in the photo rather than piled on one spot.
         * Composition is information — five stickers arranged on a desk were
         * arranged by someone — and it costs nothing to keep, where throwing it
         * away leaves a heap that has to be untangled by hand before the
         * collage can start.
         */
        async addPieces(cut, original, options) {
            const pieces = cut.pieces ?? [];
            const source = cut.source!;
            // The photo's own footprint on the canvas: every piece is placed as
            // a fraction of it, so the group arrives at the size and spot the
            // whole picture would have.
            const width = options.width ?? Math.min(source.width, 420);
            const spot = collage.spotFor({
                x: options.x,
                y: options.y,
                near: options.near,
                width,
                height: width * (source.height / Math.max(1, source.width)),
            });

            const added: ImageLayer[] = [];

            // The backplate first, so everything else stacks on top of it, and
            // filling the group's whole box because that is exactly the frame
            // the objects were lifted out of. No sticker rim on it either: it
            // is a scene, not a cut-out, and a white edge round the room would
            // be absurd.
            if (cut.backplate) {
                const storageKey = newImageKey();
                await putImage(storageKey, cut.backplate);
                const src = trackUrl(URL.createObjectURL(cut.backplate));
                const loaded = await loadImage(src);
                const layer = collage.addImage({
                    src,
                    storageKey,
                    label: options.label ? `${options.label} background` : "background",
                    natural: { width: loaded.width, height: loaded.height },
                    crop: loaded.crop,
                    x: spot.x,
                    y: spot.y,
                    width: spot.width,
                    style: { silhouette: null, outline: null, shadow: null, opacity: 1 },
                });
                images.set(layer.id, loaded);
                added.push(collage.get(layer.id) as ImageLayer);
            }

            for (const [index, piece] of pieces.entries()) {
                const storageKey = newImageKey();
                await putImage(storageKey, piece.blob);
                const src = trackUrl(URL.createObjectURL(piece.blob));
                const loaded = await loadImage(src);
                const layer = collage.addImage({
                    src,
                    storageKey,
                    // The caller's own name for it wins: "cape woman" is worth
                    // more later than "poster 2".
                    label: piece.label
                        ?? (pieces.length > 1 && options.label ? `${options.label} ${index + 1}` : options.label),
                    natural: { width: loaded.width, height: loaded.height },
                    crop: loaded.crop,
                    x: spot.x + (piece.x / source.width) * spot.width,
                    y: spot.y + (piece.y / source.height) * spot.height,
                    width: (piece.width / source.width) * spot.width,
                    // Plain, unlike a photo dropped in on its own.
                    //
                    // The sticker look is what makes a lone cut-out read as a
                    // cut-out on an empty canvas. These are not lone cut-outs:
                    // they came out of one picture and are still standing in
                    // its arrangement, so a white rim round each of them draws
                    // a border through the middle of a scene that is supposed
                    // to look like a scene. Anyone who wants the stickers can
                    // ask for them once the pieces are apart.
                    style: { silhouette: null, outline: null, shadow: null, opacity: 1 },
                });
                images.set(layer.id, loaded);
                added.push(collage.get(layer.id) as ImageLayer);
            }

            // The objects, not counting the scene they came out of — "6 pieces"
            // for five stickers and a desk is the kind of small lie that makes
            // the rest of the message untrustworthy.
            const objects = added.slice(cut.backplate ? 1 : 0);
            record(
                "image-added",
                `${objects.length} separate pieces were cut out of "${options.label ?? "an image"}"` +
                `${cut.backplate ? ", and the scene behind them was painted in" : ""}.`,
                options.by ?? "human",
                { ids: added.map(l => l.id), pieces: objects.length, backplate: !!cut.backplate });

            void original;
            // The first *object*, not the backplate: a caller asking "what did I
            // just add" means the thing, not the room behind it.
            const primary = objects[0] ?? added[0];
            return {
                layer: primary,
                pieces: added,
                loaded: images.get(primary.id)!,
                background: cut,
            };
        },

        async traceToSvg(id, options = {}) {
            const layer = collage.get(id);
            if (!layer || layer.kind !== "image") return { ok: false, reason: `${id} is not an image layer.` };
            const loaded = images.get(id);
            if (!loaded) return { ok: false, reason: `"${layer.label}" has not finished loading.` };
            if (loaded.tainted) {
                return {
                    ok: false,
                    reason: `"${layer.label}" came from another site without permission to read its pixels, ` +
                        `so it cannot be traced. Re-add it from a file.`,
                };
            }

            // Enough resolution for the curve fitter to see edges, nowhere near
            // full size: tracing a twelve-megapixel photo is slow and yields an
            // SVG bigger than the photo.
            const pixels = readPixels(loaded.image, loaded.width, loaded.height, TRACE_EDGE);
            const traced = await traceToSvgPixels(pixels, options);
            if (!traced) {
                return { ok: false, reason: `"${layer.label}" could not be traced — it may be too soft or too plain.` };
            }

            const blob = svgBlob(traced.svg);
            const storageKey = newImageKey();
            await putImage(storageKey, blob);
            const src = trackUrl(URL.createObjectURL(blob));
            const next = await adopt(id, src);
            collage.setSource(id, src, storageKey, { width: next.width, height: next.height }, next.crop);
            record("layer-styled", `"${layer.label}" was traced into ${traced.paths} shapes.`, "human",
                { id, paths: traced.paths });
            return { ok: true, paths: traced.paths, bytes: blob.size };
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

        onSettle(callback) {
            settleWatchers.add(callback);
            return () => { settleWatchers.delete(callback); };
        },

        arrange(frameId, mode, options = {}) {
            // Before the moves, so the view can turn transitions on for them.
            announceSettle();
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
            // A packing layout fills a chosen paper size, but on the free canvas
            // it keeps the total amount of artwork instead. The page there is
            // refitted to the contents, so "fill the page" closes a loop that
            // takes a few percent off the collage every time it is arranged.
            const placements = computeLayout(inside, frame, mode, {
                fill: pagePreset !== FREE_PAGE,
                // The silhouettes, so a packing layout can nest shapes rather
                // than boxes. Built from the alpha masks the canvas already
                // keeps for hit testing, so nothing extra is decoded.
                shapes: silhouettesOf(inside),
                ...options,
            });
            for (const placement of placements) {
                const layer = collage.get(placement.id);
                if (!layer) continue;
                // A dense pack IS its sizes — items are fitted against each
                // other, so keeping the old ones would put everything back on
                // top of everything. It is safe here in a way it was not
                // before: the packer solves for the scale that fills the page
                // rather than scaling by height alone, so a second pass lands
                // on the same scale instead of shrinking again.
                if (options.resize ?? mode === "collage") {
                    collage.update(placement.id, {
                        x: placement.x,
                        y: placement.y,
                        width: placement.width,
                        height: placement.height,
                        rotation: placement.rotation,
                    });
                    continue;
                }
                // Sizes are left alone by default. Each layout computes a size
                // that fits the page, so re-running one compounded: everything
                // got a little smaller every single time it was arranged. Keep
                // the layer's size and centre it on the spot chosen for it.
                collage.update(placement.id, {
                    x: placement.x + (placement.width - layer.width) / 2,
                    y: placement.y + (placement.height - layer.height) / 2,
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
            pagePreset = knownPage(frames[0]?.presetId);
            collage.restore(restored, frames, doc.stages ?? []);
            // Decode in parallel — a dozen images should not be a dozen waits.
            await Promise.all(restored
                .filter((l): l is ImageLayer => l.kind === "image")
                .map(layer => adopt(layer.id, layer.src).catch(() => undefined)));
            return restored.length;
        },

        async saveFile() {
            this.refitPage();
            const frame = pageFrame() ?? this.setPage(pagePreset);
            const layers = layersOf(frame.id);
            await fontsReady(layers);

            // A preview at screen size rather than print size. This is the part
            // a person looks at; the part that reopens is exact regardless, and
            // a 300dpi A4 render would make an eight-megabyte file out of a
            // collage whose actual contents are two.
            const size = outputSize(frame, 96);
            const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
            const canvas = renderFrame(frame, layers, images, {
                width: Math.max(1, Math.round(size.width * scale)),
                height: Math.max(1, Math.round(size.height * scale)),
            });
            const png = new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());

            // Each layer's bytes, once, however many layers share them.
            const assets: CollageAsset[] = [];
            const seen = new Set<string>();
            // Every layer, not the visible stage's: a saved file has to carry
            // the whole show, not the scene that happened to be up.
            for (const layer of collage.listAll()) {
                if (layer.kind !== "image" || !layer.storageKey || seen.has(layer.storageKey)) continue;
                seen.add(layer.storageKey);
                const blob = await getImage(layer.storageKey);
                if (!blob) continue;
                assets.push({
                    key: layer.storageKey,
                    type: blob.type || "image/png",
                    data: new Uint8Array(await blob.arrayBuffer()),
                });
            }

            const doc: StoredDoc = {
                version: 1,
                savedAt: Date.now(),
                // Same rule as localStorage: a blob: URL means nothing to
                // whoever opens this next, so the storageKey is what travels.
                layers: collage.listAll().map(layer =>
                    layer.kind === "image" && layer.storageKey ? { ...layer, src: "" } : layer),
                frames: [frame],
                ...(lastView ? { view: lastView } : {}),
            };

            record("exported", `Saved "${frame.name}" as an openable collage.`, "human", { format: "collage" });
            return {
                blob: new Blob([packCollage(png, { doc, assets })], { type: "image/png" }),
                filename: `${slug(frame.name)}.collage.png`,
            };
        },

        async openFile(file) {
            const payload = readCollage(new Uint8Array(await file.arrayBuffer()));
            if (!payload) return 0;

            // Keys are re-minted rather than reused. Two files made in the same
            // browser can hold the same key for different bytes, and opening
            // one onto the other would silently swap the pictures.
            const remap = new Map<string, string>();
            for (const asset of payload.assets) {
                const key = newImageKey();
                remap.set(asset.key, key);
                await putImage(key, new Blob([asset.data], { type: asset.type }));
            }

            // Added, not restored. Dropping a collage onto work in progress must
            // not throw that work away — and because these are ordinary adds,
            // one Ctrl+Z takes the whole thing back off again.
            const arriving: Layer[] = [];
            for (const layer of payload.doc.layers) {
                if (layer.kind !== "image") {
                    arriving.push(collage.addText({ ...layer, id: undefined }));
                    continue;
                }
                const key = layer.storageKey ? remap.get(layer.storageKey) ?? null : null;
                if (layer.storageKey && !key) continue; // Bytes missing; the layer would be a hole.
                const blob = key ? await getImage(key) : null;
                const src = blob ? trackUrl(URL.createObjectURL(blob)) : layer.src;
                if (!src) continue;
                arriving.push(collage.addImage({ ...layer, id: undefined, src, storageKey: key }));
            }

            // An empty canvas takes the file's page; an occupied one keeps its
            // own, because the person arranging it chose that.
            if (collage.listAll().length === arriving.length) {
                const frame = payload.doc.frames[0];
                if (frame) this.setPage(knownPage(frame.presetId));
                lastView = payload.doc.view;
            }

            await Promise.all(arriving
                .filter((l): l is ImageLayer => l.kind === "image")
                .map(layer => adopt(layer.id, layer.src).catch(() => undefined)));
            selection = arriving.map(l => l.id);
            for (const watcher of [...selectionWatchers]) watcher();
            scheduleSave();
            record("opened", `Opened a saved collage — ${arriving.length} layer(s).`);
            return arriving.length;
        },

        settle: announceSettle,

        setPerformer(next) {
            performer = next;
        },

        /** The canvas hands this back so a scene can be abandoned from anywhere. */
        setStopper(stop: (() => void) | null) {
            stopPerformance = stop;
        },

        setSpeaker(next: Speaker | null) {
            speaker = next ?? SILENT;
        },

        get speaker() {
            return speaker;
        },

        get performing() {
            return acting;
        },

        async playScene(plan) {
            acting = true;
            try {
                // One undo entry for the scene. Every travelling beat commits
                // as it plays — the beat then animates in from behind, which is
                // how a walk arrives without a frame of flicker — and grouping
                // them means undo takes back the scene, not each footstep.
                await collage.batch(async () => {
                    if (performer) await performer(plan);
                });
            } finally {
                acting = false;
            }
            scheduleSave();
        },

        stopScene() {
            stopPerformance?.();
        },

        get showing() {
            return running;
        },

        playShow(stageIds) {
            const wanted = stageIds?.length
                ? stageIds.map(id => collage.getStage(id)).filter((s): s is Stage => !!s)
                : collage.listStages();

            // The plan is worked out for every scene before the first one runs,
            // so the agent gets the whole timetable in the reply rather than
            // discovering scene four's start time when it arrives.
            const timings: ShowTiming[] = [];
            let at = 0;
            for (const stage of wanted) {
                const { beats } = sceneBeats(stage, id => collage.get(id)?.height ?? 100);
                const { plan } = planScene(beats);
                const hold = (stage.hold ?? DEFAULT_HOLD) * 1000;
                timings.push({ stage: stage.id, name: stage.name, at, duration: plan.duration + hold });
                at += plan.duration + hold;
            }

            void runShow(wanted);
            return { timings, duration: at };
        },

        stopShow() {
            wanted = false;
            running = null;
            stopPerformance?.();
            speaker.stop();
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
            // A face that has not arrived draws as the fallback without
            // complaining, so an export started before the font landed would
            // quietly disagree with what is on screen.
            await fontsReady(layers);
            // A chosen paper size crops, which is the point of choosing one —
            // but a silent crop is how an export comes back missing an edge the
            // person never knew was there. Counted once, reported everywhere.
            const overflowing = layers.filter(layer => !contains(frame, bounds(layer))).length;
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
                        `${frame.physical ? ` (${frame.physical.width}×${frame.physical.height}mm at ${dpi} dpi)` : ""}.` +
                        cropNote(overflowing),
                    structured: {
                        filename, width: size.width, height: size.height, bytes: blob.size, cropped: overflowing,
                    },
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

    return studio;
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
/**
 * Resolves true when the print dialogue actually opened, false when this
 * browser has no print at all — which in-app web views routinely do not.
 *
 * It used to resolve `void`, so the caller's `if (printed)` was false even on a
 * successful print: every print also downloaded the PNG fallback and reported
 * that printing was unavailable, while the dialogue was open in front of you.
 */
function printDocument(html: string): Promise<boolean> {
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
                    resolve(true);
                } catch {
                    // No print in this browser. Not an error — the caller has a
                    // fallback, and that is the whole reason for the boolean.
                    resolve(false);
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
