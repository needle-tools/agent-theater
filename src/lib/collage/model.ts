/**
 * The collage document: an infinite canvas of layers, plus frames that decide
 * what gets exported and at what size.
 *
 * One decision shapes this whole file. Layers store their position in *canvas
 * units* — never in fractions of a frame. Fractions are derived at export time
 * (see `placementIn`). It is tempting to store them per-frame, and it is wrong:
 * a layer may sit inside an A4 frame and an og:image frame at once, and there
 * is no single frame to be a fraction of. The canvas is the truth; a frame is a
 * question you ask of it.
 *
 * One canvas unit is one CSS pixel at 100% zoom, which makes an A4 frame 794
 * units wide — the size it would print at 96 dpi. Frames therefore appear on
 * screen at roughly life size, and export resolution is a separate concern that
 * only shows up when someone asks for 300 dpi.
 */

export const MM_PER_INCH = 25.4;
/** CSS pixels per inch — the ratio that makes a frame look life-sized on screen. */
export const SCREEN_DPI = 96;

export type LayerKind = "image" | "text";

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A sub-rectangle of a source image, in fractions of its natural size. */
export interface CropBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Shadow {
    /** Offset in canvas units. */
    x: number;
    y: number;
    blur: number;
    color: string;
    opacity: number;
}

export interface Outline {
    /** Width in canvas units. Drawn outside the alpha edge, sticker style. */
    width: number;
    color: string;
}

export interface LayerStyle {
    /** Fill the alpha shape with a flat colour instead of drawing the pixels. */
    silhouette: string | null;
    outline: Outline | null;
    shadow: Shadow | null;
    opacity: number;
}

interface LayerBase {
    id: string;
    label: string;
    /** Top-left in canvas units. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Degrees, clockwise, about the layer's centre. */
    rotation: number;
    /** Paint order. Higher is nearer the viewer. */
    z: number;
}

export interface ImageLayer extends LayerBase {
    kind: "image";
    /**
     * A URL that can be drawn right now — an http(s) address, or a blob: URL
     * for an image held in IndexedDB.
     */
    src: string;
    /**
     * Key of the image's bytes in IndexedDB, for anything that came from the
     * person's own machine. `src` is a blob: URL that dies with the tab, so
     * this is what actually survives a reload. Null for images that live at a
     * URL of their own and need no copy.
     */
    storageKey: string | null;
    /** Intrinsic pixel size of the source, before cropping. */
    natural: { width: number; height: number };
    /**
     * The part of the source actually drawn — for a cut-out this is its alpha
     * bounding box, so a mostly-empty PNG lays out as the shape you can see
     * rather than as the transparent rectangle around it.
     */
    crop: CropBox;
    style: LayerStyle;
}

export interface TextLayer extends LayerBase {
    kind: "text";
    text: string;
    color: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    align: "left" | "center" | "right";
    opacity: number;
}

export type Layer = ImageLayer | TextLayer;

export interface Frame extends Rect {
    id: string;
    name: string;
    presetId: string;
    background: string;
    /**
     * Physical size for print targets. Present means "this is paper": exports
     * gain a dpi and the quality check has something real to measure against.
     */
    physical: { width: number; height: number; unit: "mm" } | null;
    /** Pixel size for screen targets. Null when `physical` decides the size. */
    output: { width: number; height: number } | null;
}

export interface FramePreset {
    id: string;
    name: string;
    /** Shown in the picker. The rest stay available to agents by name. */
    common?: boolean;
    /**
     * Label for a picker tile, where the shape is doing most of the explaining
     * and there is room for about six characters. `name` stays the full one —
     * it goes into the frame, the export title and what an agent reads, none of
     * which are short of space.
     */
    short?: string;
    physical?: { width: number; height: number; unit: "mm" };
    output?: { width: number; height: number };
}

/**
 * The targets worth naming. Paper presets carry millimetres so they can be
 * exported at any dpi; screen presets carry the exact pixels a platform wants,
 * because "1200×630, no really" is the whole point of an og:image.
 */
export const FRAME_PRESETS: FramePreset[] = [
    { id: "a4-portrait", name: "A4 portrait", short: "A4", common: true, physical: { width: 210, height: 297, unit: "mm" } },
    { id: "a4-landscape", name: "A4 landscape", short: "A4 wide", common: true, physical: { width: 297, height: 210, unit: "mm" } },
    { id: "square-1080", name: "Square post", short: "Square", common: true, output: { width: 1080, height: 1080 } },
    { id: "story-1080x1920", name: "Story", short: "Story", common: true, output: { width: 1080, height: 1920 } },
    { id: "og-1200x630", name: "Social card (og:image)", short: "Social", common: true, output: { width: 1200, height: 630 } },

    // Not in the picker. Every one of these is a near-duplicate in shape of one
    // above it, and a list of eleven paper sizes is a list nobody reads. They
    // stay reachable through collage_set_page, where naming one costs nothing.
    { id: "a5-portrait", name: "A5 portrait", physical: { width: 148, height: 210, unit: "mm" } },
    { id: "a3-portrait", name: "A3 portrait", physical: { width: 297, height: 420, unit: "mm" } },
    { id: "letter-portrait", name: "US Letter portrait", physical: { width: 215.9, height: 279.4, unit: "mm" } },
    { id: "slide-16x9", name: "Slide 16:9", output: { width: 1920, height: 1080 } },
    { id: "web-hero", name: "Website hero", output: { width: 1600, height: 700 } },
];

/** How wide a preset is relative to its height — what a preview draws. */
export function presetAspect(preset: FramePreset): number {
    const size = preset.physical ?? preset.output ?? { width: 1, height: 1 };
    return size.width / Math.max(0.0001, size.height);
}

export function findPreset(id: string): FramePreset | null {
    return FRAME_PRESETS.find(p => p.id === id) ?? null;
}

/** Canvas-unit size of a preset: physical millimetres at 96 dpi, or its pixels. */
export function presetCanvasSize(preset: FramePreset): { width: number; height: number } {
    if (preset.physical) {
        return {
            width: (preset.physical.width / MM_PER_INCH) * SCREEN_DPI,
            height: (preset.physical.height / MM_PER_INCH) * SCREEN_DPI,
        };
    }
    // Screen presets are often far larger than any screen; show them at a size
    // a person can actually work with and let export restore the real pixels.
    const output = preset.output ?? { width: 1000, height: 1000 };
    const scale = Math.min(1, 900 / Math.max(output.width, output.height));
    return { width: output.width * scale, height: output.height * scale };
}

/** The pixel size a frame exports at. `dpi` only matters for paper frames. */
export function outputSize(frame: Frame, dpi = 300): { width: number; height: number } {
    if (frame.physical) {
        return {
            width: Math.round((frame.physical.width / MM_PER_INCH) * dpi),
            height: Math.round((frame.physical.height / MM_PER_INCH) * dpi),
        };
    }
    return frame.output ?? { width: Math.round(frame.width), height: Math.round(frame.height) };
}

export const DEFAULT_STYLE: LayerStyle = {
    silhouette: null,
    outline: null,
    shadow: null,
    opacity: 1,
};

/**
 * The sticker look, sized to the layer it is going on.
 *
 * On by default for a dropped photo, because it is the thing that makes a
 * cut-out read as a cut-out: without a rim the shape's edge is wherever the
 * model happened to stop, and against a busy neighbour that edge disappears
 * entirely. The shadow does the same job in depth.
 *
 * Proportional, not fixed. These are canvas units, so an eight-unit rim is a
 * fat white border on a small sticker and a hairline on a large one — the same
 * number cannot be right for both, and a collage is made of both.
 */
export function stickerStyle(width: number, height: number): Partial<LayerStyle> {
    const size = Math.max(1, Math.min(width, height));
    return {
        outline: { width: clampSize(size * 0.035, 3, 18), color: "#FFFFFF" },
        shadow: {
            x: 0,
            y: clampSize(size * 0.035, 2, 14),
            blur: clampSize(size * 0.08, 6, 30),
            color: "#222C20",
            opacity: 0.3,
        },
    };
}

function clampSize(value: number, min: number, max: number): number {
    return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export const PALETTE = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];

/**
 * The typefaces on offer.
 *
 * Every stack ends in a generic family, because the exported HTML lands on a
 * page that has never heard of Needle's fonts — a collage that falls back to
 * something of the right shape is fine; one that falls back to Times is not.
 */
export interface FontChoice {
    id: string;
    /** Short on purpose: the menu renders it *in* the face, so it has to fit. */
    name: string;
    stack: string;
    weight: number;
    /**
     * The `family=` argument for Google Fonts, when the face is not already on
     * the page. Absent for Needle's own faces, which brand.css has loaded long
     * before anyone opens a menu.
     */
    google?: string;
}

export const FONTS: readonly FontChoice[] = [
    { id: "display", name: "Display", stack: "'NunitoSans', system-ui, sans-serif", weight: 800 },
    { id: "body", name: "Body", stack: "'NunitoSans', system-ui, sans-serif", weight: 500 },
    { id: "wordmark", name: "Wordmark", stack: "'Oblique', 'NunitoSans', sans-serif", weight: 700 },
    { id: "serif", name: "Serif", stack: "'IBMPlexSerif', Georgia, serif", weight: 600 },
    { id: "mono", name: "Mono", stack: "'Monaspace Neon', ui-monospace, SFMono-Regular, Menlo, monospace", weight: 500 },

    // Fetched on demand — see webfonts.ts. Each one is here because it does
    // something the five above cannot: a collage wants a shout, a scrawl and a
    // joke, not five weights of the same well-behaved sans.
    { id: "poster", name: "Poster", stack: "'Anton', Impact, sans-serif", weight: 400, google: "Anton" },
    { id: "marker", name: "Marker", stack: "'Permanent Marker', cursive", weight: 400, google: "Permanent+Marker" },
    { id: "hand", name: "Hand", stack: "'Caveat', 'Segoe Script', cursive", weight: 700, google: "Caveat:wght@700" },
    { id: "juicy", name: "Juicy", stack: "'Shrikhand', Georgia, serif", weight: 400, google: "Shrikhand" },
    { id: "sign", name: "Sign", stack: "'Bungee', Impact, sans-serif", weight: 400, google: "Bungee" },
    { id: "fancy", name: "Fancy", stack: "'Fraunces', Georgia, serif", weight: 700, google: "Fraunces:opsz,wght@9..144,700" },
    { id: "pixel", name: "Pixel", stack: "'Press Start 2P', ui-monospace, monospace", weight: 400, google: "Press+Start+2P" },
];

export type FontId = FontChoice["id"];

export function findFont(id: string) {
    return FONTS.find(f => f.id === id) ?? null;
}

export interface AddImageSpec {
    src: string;
    label?: string;
    natural: { width: number; height: number };
    crop?: CropBox;
    storageKey?: string | null;
    /** Restore an existing id, so a reloaded layer keeps the id agents saw. */
    id?: string;
    z?: number;
    /** Put it here — a right-click, a drop — rather than on the auto spiral. */
    near?: { x: number; y: number };
    x?: number;
    y?: number;
    /** Canvas-unit width. Height follows from the cropped aspect ratio. */
    width?: number;
    rotation?: number;
    style?: Partial<LayerStyle>;
}

export interface AddTextSpec {
    text: string;
    label?: string;
    id?: string;
    z?: number;
    /** Put it here — a right-click, a drop — rather than on the auto spiral. */
    near?: { x: number; y: number };
    x?: number;
    y?: number;
    width?: number;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    align?: "left" | "center" | "right";
    rotation?: number;
}

export interface AddFrameSpec {
    presetId?: string;
    name?: string;
    x?: number;
    y?: number;
    /** Explicit canvas size. Overrides the preset's natural size. */
    width?: number;
    height?: number;
    background?: string;
    /** Custom paper size, when no preset says it. */
    physical?: { width: number; height: number; unit: "mm" };
    output?: { width: number; height: number };
}

export interface LayerPatch {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    z?: number;
    label?: string;
    text?: string;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    align?: "left" | "center" | "right";
    style?: Partial<LayerStyle>;
}

export interface CollageOptions {
    newId?: (prefix: string) => string;
    /** Injectable so the undo history's coalescing window can be tested. */
    now?: () => number;
}

const FULL_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };

interface Snapshot {
    layers: Layer[];
    frames: Frame[];
}

/** Edits of the same kind closer together than this undo as one step. */
const COALESCE_MS = 700;
/** Deep enough to cover a working session; snapshots are references, not copies. */
const MAX_HISTORY = 120;

/**
 * Holds the document and is the only thing allowed to change it.
 *
 * Every mutation funnels through here so that the UI, the WebMCP tools and any
 * later undo stack all observe the same change signal — the same reason the
 * shared room routes its edits through one object.
 */
export class Collage {
    private readonly layers = new Map<string, Layer>();
    private readonly frames = new Map<string, Frame>();
    private readonly changed = new Set<() => void>();
    private readonly newId: (prefix: string) => string;
    private counter = 0;
    private nearCounter = 0;
    private lastOrigin: string | null = null;
    private topZ = 0;

    /**
     * Undo history.
     *
     * Snapshots rather than inverse operations: every mutation here already
     * replaces layer objects instead of mutating them, so a snapshot is a copy
     * of two arrays of references — cheap, and impossible to get subtly wrong
     * the way hand-written inverses are.
     *
     * Every edit is undoable regardless of who made it. An agent's change is
     * exactly the kind you most want to be able to take back.
     */
    private readonly past: Snapshot[] = [];
    private readonly future: Snapshot[] = [];
    /** Identifies the edit on top of the stack, for coalescing. */
    private lastEdit: { key: string; at: number } | null = null;
    /** True while undoing, so restoring state does not itself become history. */
    private replaying = false;

    private readonly now: () => number;

    constructor(options?: CollageOptions) {
        let n = 0;
        this.newId = options?.newId ?? (prefix => `${prefix}-${(++n).toString(36)}-${randomSuffix()}`);
        this.now = options?.now ?? (() => Date.now());
    }

    onChanged(callback: () => void): () => void {
        this.changed.add(callback);
        return () => { this.changed.delete(callback); };
    }

    // ── History ──────────────────────────────────────────────────────────────

    /**
     * Record the state before an edit.
     *
     * `key` groups edits that should undo together. A drag calls update() on
     * every pointer move; without grouping, undo would step back through
     * hundreds of intermediate positions instead of putting the layer back
     * where it started. Repeats of the same key in quick succession keep the
     * first snapshot, which is the one that holds the original state.
     */
    private remember(key: string) {
        if (this.replaying) return;
        const now = this.now();
        if (this.lastEdit && this.lastEdit.key === key && now - this.lastEdit.at < COALESCE_MS) {
            this.lastEdit.at = now;
            return;
        }
        this.past.push({ layers: [...this.layers.values()], frames: [...this.frames.values()] });
        if (this.past.length > MAX_HISTORY) this.past.shift();
        // Any new edit abandons the redo branch, as everywhere else.
        this.future.length = 0;
        this.lastEdit = { key, at: now };
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    undo(): boolean {
        const previous = this.past.pop();
        if (!previous) return false;
        this.future.push({ layers: [...this.layers.values()], frames: [...this.frames.values()] });
        this.apply(previous);
        return true;
    }

    redo(): boolean {
        const next = this.future.pop();
        if (!next) return false;
        this.past.push({ layers: [...this.layers.values()], frames: [...this.frames.values()] });
        this.apply(next);
        return true;
    }

    private apply(snapshot: Snapshot) {
        this.replaying = true;
        this.layers.clear();
        this.frames.clear();
        for (const layer of snapshot.layers) this.layers.set(layer.id, layer);
        for (const frame of snapshot.frames) this.frames.set(frame.id, frame);
        // A fresh edit after an undo must not coalesce into the edit it undid.
        this.lastEdit = null;
        this.replaying = false;
        this.emit();
    }

    list(): Layer[] {
        return [...this.layers.values()].sort((a, b) => a.z - b.z);
    }

    get(id: string): Layer | null {
        return this.layers.get(id) ?? null;
    }

    listFrames(): Frame[] {
        return [...this.frames.values()];
    }

    getFrame(id: string): Frame | null {
        return this.frames.get(id) ?? null;
    }

    isEmpty(): boolean {
        return this.layers.size === 0 && this.frames.size === 0;
    }

    addImage(spec: AddImageSpec): ImageLayer {
        this.remember(`add-${this.layers.size}`);
        const crop = spec.crop ?? FULL_CROP;
        // Width defaults to the cut-out's own pixels, capped so a 4000px photo
        // does not arrive as a wall. Height always follows the crop's aspect,
        // because a stretched cut-out looks like a mistake and never like a
        // choice.
        const croppedWidth = Math.max(1, spec.natural.width * crop.width);
        const croppedHeight = Math.max(1, spec.natural.height * crop.height);
        const width = spec.width ?? Math.min(croppedWidth, 420);
        const height = width * (croppedHeight / croppedWidth);
        // Once, not once per axis: calling nextSpot() separately for x and y
        // took each from a different point on the spiral and advanced it twice.
        const spot = spec.x === undefined || spec.y === undefined ? this.nextSpot(spec.near) : null;
        const layer: ImageLayer = {
            id: spec.id ?? this.newId("img"),
            kind: "image",
            label: spec.label ?? `image ${this.layers.size + 1}`,
            src: spec.src,
            storageKey: spec.storageKey ?? null,
            natural: { ...spec.natural },
            crop: { ...crop },
            x: spec.x ?? spot!.x - width / 2,
            y: spec.y ?? spot!.y - height / 2,
            width,
            height,
            rotation: spec.rotation ?? 0,
            z: spec.z ?? ++this.topZ,
            // Sized against the layer, so the rim is a rim at any scale. An
            // explicit style still wins outright — a paste carries the original
            // layer's, and restoring one must not restyle it.
            style: { ...DEFAULT_STYLE, ...stickerStyle(width, height), ...spec.style },
        };
        if (layer.z > this.topZ) this.topZ = layer.z;
        this.layers.set(layer.id, layer);
        this.emit();
        return layer;
    }

    /**
     * The box a picture of this size would occupy, without adding it.
     *
     * For placing a *group* where one picture would have gone: a photo that
     * turns out to hold five objects should land where the photo would have,
     * with the five arranged inside it as they were. Taking the spot once and
     * laying the pieces out within it is what keeps that arrangement, and what
     * stops the placement spiral advancing five times for one drop.
     */
    spotFor(spec: { x?: number; y?: number; near?: { x: number; y: number }; width: number; height: number }): Rect {
        const spot = spec.x === undefined || spec.y === undefined ? this.nextSpot(spec.near) : null;
        return {
            x: spec.x ?? spot!.x - spec.width / 2,
            y: spec.y ?? spot!.y - spec.height / 2,
            width: spec.width,
            height: spec.height,
        };
    }

    addText(spec: AddTextSpec): TextLayer {
        this.remember(`add-${this.layers.size}`);
        const fontSize = spec.fontSize ?? 48;
        const width = spec.width ?? Math.max(120, spec.text.length * fontSize * 0.5);
        const spot = spec.x === undefined || spec.y === undefined ? this.nextSpot(spec.near) : null;
        const layer: TextLayer = {
            id: spec.id ?? this.newId("txt"),
            kind: "text",
            label: spec.label ?? spec.text.slice(0, 24),
            text: spec.text,
            x: spec.x ?? spot!.x - width / 2,
            y: spec.y ?? spot!.y - fontSize / 2,
            width,
            height: fontSize * 1.25,
            rotation: spec.rotation ?? 0,
            z: spec.z ?? ++this.topZ,
            color: spec.color ?? "#222C20",
            fontSize,
            fontFamily: spec.fontFamily ?? "Inter, system-ui, sans-serif",
            fontWeight: spec.fontWeight ?? 700,
            align: spec.align ?? "left",
            opacity: 1,
        };
        this.layers.set(layer.id, layer);
        this.emit();
        return layer;
    }

    /**
     * Point an image layer at a different URL.
     *
     * Two callers, both unavoidable: a blob: URL from IndexedDB after a reload
     * (the old one died with the tab), and a freshly cut-out version of an
     * image whose background has just been removed.
     */
    setSource(id: string, src: string, storageKey?: string | null, natural?: { width: number; height: number }, crop?: CropBox): ImageLayer | null {
        const current = this.layers.get(id);
        if (!current || current.kind !== "image") return null;
        this.remember(`source-${id}`);
        const next: ImageLayer = {
            ...current,
            src,
            storageKey: storageKey === undefined ? current.storageKey : storageKey,
            natural: natural ?? current.natural,
            crop: crop ?? current.crop,
        };
        // The visible shape may have changed size — a cut-out is a different
        // aspect ratio from the photo it came from — so keep the layer's width
        // and let the height follow the new crop.
        if (crop || natural) {
            const croppedWidth = Math.max(1, next.natural.width * next.crop.width);
            const croppedHeight = Math.max(1, next.natural.height * next.crop.height);
            next.height = next.width * (croppedHeight / croppedWidth);
        }
        this.layers.set(id, next);
        this.emit();
        return next;
    }

    /**
     * Resize a text layer's box to fit what it now says, leaving the type size
     * alone. Separate from `update` because a width change there means "make
     * the type bigger", which is the opposite of what a finished edit wants.
     */
    fitText(id: string, width: number, height: number): TextLayer | null {
        const current = this.layers.get(id);
        if (!current || current.kind !== "text") return null;
        this.remember(`fit-${id}`);
        const next: TextLayer = {
            ...current,
            width: Math.max(8, width),
            height: Math.max(8, height),
        };
        this.layers.set(id, next);
        this.emit();
        return next;
    }

    /** Replace the whole document — used when restoring a saved collage. */
    restore(layers: Layer[], frames: Frame[]) {
        // Loading a session is not an edit, and undoing back past it into the
        // previous session's contents would be nonsense.
        this.past.length = 0;
        this.future.length = 0;
        this.lastEdit = null;
        this.layers.clear();
        this.frames.clear();
        for (const layer of layers) {
            this.layers.set(layer.id, layer);
            if (layer.z > this.topZ) this.topZ = layer.z;
        }
        for (const frame of frames) this.frames.set(frame.id, frame);
        this.counter = layers.length;
        this.emit();
    }

    update(id: string, patch: LayerPatch): Layer | null {
        const current = this.layers.get(id);
        if (!current) return null;
        // Grouped by what is being changed, so a whole drag is one undo step
        // but a drag followed by a recolour is two.
        this.remember(`${Object.keys(patch).sort().join(",")}-${id}`);
        const next = { ...current } as Layer;

        if (typeof patch.x === "number") next.x = patch.x;
        if (typeof patch.y === "number") next.y = patch.y;
        if (typeof patch.rotation === "number") next.rotation = patch.rotation;
        if (typeof patch.z === "number") next.z = patch.z;
        if (typeof patch.label === "string") next.label = patch.label;

        // Resizing keeps the aspect ratio unless both dimensions are given —
        // the aspect is a property of the pixels, not of the layout.
        if (typeof patch.width === "number" && patch.width > 0) {
            const ratio = current.height / current.width;
            next.width = patch.width;
            next.height = typeof patch.height === "number" && patch.height > 0
                ? patch.height
                : patch.width * ratio;
        } else if (typeof patch.height === "number" && patch.height > 0) {
            const ratio = current.width / current.height;
            next.height = patch.height;
            next.width = patch.height * ratio;
        }

        if (next.kind === "text" && current.kind === "text") {
            if (typeof patch.text === "string") {
                next.text = patch.text;
                next.label = patch.label ?? patch.text.slice(0, 24);
            }
            if (typeof patch.color === "string") next.color = patch.color;
            if (typeof patch.fontFamily === "string") next.fontFamily = patch.fontFamily;
            if (typeof patch.fontWeight === "number" && patch.fontWeight > 0) next.fontWeight = patch.fontWeight;
            if (patch.align) next.align = patch.align;
            if (typeof patch.fontSize === "number" && patch.fontSize > 0) {
                next.fontSize = patch.fontSize;
                next.height = patch.fontSize * 1.25;
            } else if (typeof patch.width === "number" && patch.width > 0) {
                // Dragging a text layer's handle has to change the type size.
                // Widening the box alone does nothing you can see — it was the
                // resize that "did not work".
                next.fontSize = Math.max(4, current.fontSize * (patch.width / current.width));
                next.height = next.fontSize * 1.25;
            }
        }

        if (patch.style && next.kind === "image" && current.kind === "image") {
            next.style = { ...current.style, ...patch.style };
        }

        this.layers.set(id, next);
        if (next.z > this.topZ) this.topZ = next.z;
        this.emit();
        return next;
    }

    bringToFront(id: string): Layer | null {
        return this.update(id, { z: ++this.topZ });
    }

    sendToBack(id: string): Layer | null {
        const lowest = Math.min(...[...this.layers.values()].map(l => l.z), 0);
        return this.update(id, { z: lowest - 1 });
    }

    remove(id: string): Layer | null {
        const layer = this.layers.get(id);
        if (!layer) return null;
        this.remember(`remove-${id}`);
        this.layers.delete(id);
        this.emit();
        return layer;
    }

    addFrame(spec: AddFrameSpec): Frame {
        this.remember(`frame-add`);
        const preset = spec.presetId ? findPreset(spec.presetId) : null;
        const physical = spec.physical ?? preset?.physical ?? null;
        const output = spec.output ?? preset?.output ?? null;
        const natural = preset
            ? presetCanvasSize(preset)
            : physical
                ? presetCanvasSize({ id: "custom", name: "custom", physical })
                : output
                    ? presetCanvasSize({ id: "custom", name: "custom", output })
                    : { width: 800, height: 600 };
        const width = spec.width ?? natural.width;
        const height = spec.height ?? natural.height;
        const frame: Frame = {
            id: this.newId("frame"),
            name: spec.name ?? preset?.name ?? "Frame",
            presetId: spec.presetId ?? "custom",
            x: spec.x ?? 0,
            y: spec.y ?? 0,
            width,
            height,
            background: spec.background ?? "#FFFFFF",
            physical: physical ? { ...physical } : null,
            output: output ? { ...output } : null,
        };
        this.frames.set(frame.id, frame);
        this.emit();
        return frame;
    }

    updateFrame(id: string, patch: Partial<Pick<Frame, "x" | "y" | "width" | "height" | "name" | "background">>): Frame | null {
        const current = this.frames.get(id);
        if (!current) return null;
        this.remember(`frame-${id}`);
        const next: Frame = { ...current, ...stripUndefined(patch) };
        this.frames.set(id, next);
        this.emit();
        return next;
    }

    removeFrame(id: string): Frame | null {
        const frame = this.frames.get(id);
        if (!frame) return null;
        this.remember(`frame-remove-${id}`);
        this.frames.delete(id);
        this.emit();
        return frame;
    }

    /**
     * Layers a frame would export, in paint order.
     *
     * Membership is by overlap, not by assignment. Nothing gets "put into" a
     * frame — you move a frame over the work and it captures what it covers,
     * which is how a viewfinder behaves and how people expect this to feel.
     */
    layersIn(frameId: string): Layer[] {
        const frame = this.frames.get(frameId);
        if (!frame) return [];
        return this.list().filter(layer => overlaps(bounds(layer), frame));
    }

    /** Bounding box of everything on the canvas, or null when it is empty. */
    contentBounds(ids?: string[]): Rect | null {
        const layers = ids
            ? ids.map(id => this.layers.get(id)).filter((l): l is Layer => !!l)
            : this.list();
        return unionBounds(layers.map(bounds));
    }

    /**
     * Where to put something nobody gave a position for.
     *
     * A golden-angle spiral, so five images dropped at once read as five images
     * rather than one stack. Given a point — a right-click, a drop — the first
     * lands exactly on it and the rest fan out around it, because "it should
     * appear where I clicked" is only true of the thing you just asked for.
     */
    private nextSpot(near?: { x: number; y: number }): { x: number; y: number } {
        if (!near) {
            const index = this.counter++;
            const angle = index * 2.399963;
            const radius = 60 + 90 * Math.sqrt(index);
            return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        }
        // A new point starts its own spiral, so the next click is not pushed
        // out by however much was added at the last one.
        const key = `${Math.round(near.x)},${Math.round(near.y)}`;
        if (key !== this.lastOrigin) {
            this.lastOrigin = key;
            this.nearCounter = 0;
        }
        const index = this.nearCounter++;
        const angle = index * 2.399963;
        const radius = 110 * Math.sqrt(index);
        return { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
    }

    private emit() {
        for (const callback of [...this.changed]) callback();
    }
}

/**
 * A layer's axis-aligned bounds, accounting for rotation. Rotated layers need
 * their swept box or a frame's overlap test quietly misses their corners.
 */
export function bounds(layer: Layer): Rect {
    if (!layer.rotation) return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    const radians = (layer.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const width = layer.width * cos + layer.height * sin;
    const height = layer.width * sin + layer.height * cos;
    return {
        x: layer.x + layer.width / 2 - width / 2,
        y: layer.y + layer.height / 2 - height / 2,
        width,
        height,
    };
}

export function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function unionBounds(rects: Rect[]): Rect | null {
    if (!rects.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where a layer sits inside a frame, as fractions of that frame.
 *
 * This is the conversion the whole export story rests on: multiply by pixels
 * for a PNG, by millimetres for print, or write the numbers out as `%` and the
 * exported web page is responsive without anyone thinking about it.
 */
export function placementIn(layer: Layer, frame: Frame) {
    return {
        left: (layer.x - frame.x) / frame.width,
        top: (layer.y - frame.y) / frame.height,
        width: layer.width / frame.width,
        height: layer.height / frame.height,
        rotation: layer.rotation,
    };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function randomSuffix(): string {
    // Not an identity, just a collision guard for ids that only live in one tab.
    return Math.random().toString(36).slice(2, 7);
}
