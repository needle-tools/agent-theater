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
    src: string;
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
    physical?: { width: number; height: number; unit: "mm" };
    output?: { width: number; height: number };
}

/**
 * The targets worth naming. Paper presets carry millimetres so they can be
 * exported at any dpi; screen presets carry the exact pixels a platform wants,
 * because "1200×630, no really" is the whole point of an og:image.
 */
export const FRAME_PRESETS: FramePreset[] = [
    { id: "a4-portrait", name: "A4 portrait", physical: { width: 210, height: 297, unit: "mm" } },
    { id: "a4-landscape", name: "A4 landscape", physical: { width: 297, height: 210, unit: "mm" } },
    { id: "a5-portrait", name: "A5 portrait", physical: { width: 148, height: 210, unit: "mm" } },
    { id: "a3-portrait", name: "A3 portrait", physical: { width: 297, height: 420, unit: "mm" } },
    { id: "letter-portrait", name: "US Letter portrait", physical: { width: 215.9, height: 279.4, unit: "mm" } },
    { id: "square-1080", name: "Square post", output: { width: 1080, height: 1080 } },
    { id: "story-1080x1920", name: "Story", output: { width: 1080, height: 1920 } },
    { id: "og-1200x630", name: "Social card (og:image)", output: { width: 1200, height: 630 } },
    { id: "slide-16x9", name: "Slide 16:9", output: { width: 1920, height: 1080 } },
    { id: "web-hero", name: "Website hero", output: { width: 1600, height: 700 } },
];

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

export const PALETTE = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];

export interface AddImageSpec {
    src: string;
    label?: string;
    natural: { width: number; height: number };
    crop?: CropBox;
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
    style?: Partial<LayerStyle>;
}

export interface CollageOptions {
    newId?: (prefix: string) => string;
}

const FULL_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };

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
    private topZ = 0;

    constructor(options?: CollageOptions) {
        let n = 0;
        this.newId = options?.newId ?? (prefix => `${prefix}-${(++n).toString(36)}-${randomSuffix()}`);
    }

    onChanged(callback: () => void): () => void {
        this.changed.add(callback);
        return () => { this.changed.delete(callback); };
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
        const crop = spec.crop ?? FULL_CROP;
        // Width defaults to the cut-out's own pixels, capped so a 4000px photo
        // does not arrive as a wall. Height always follows the crop's aspect,
        // because a stretched cut-out looks like a mistake and never like a
        // choice.
        const croppedWidth = Math.max(1, spec.natural.width * crop.width);
        const croppedHeight = Math.max(1, spec.natural.height * crop.height);
        const width = spec.width ?? Math.min(croppedWidth, 420);
        const height = width * (croppedHeight / croppedWidth);
        const layer: ImageLayer = {
            id: this.newId("img"),
            kind: "image",
            label: spec.label ?? `image ${this.layers.size + 1}`,
            src: spec.src,
            natural: { ...spec.natural },
            crop: { ...crop },
            x: spec.x ?? this.nextSpot().x - width / 2,
            y: spec.y ?? this.nextSpot().y - height / 2,
            width,
            height,
            rotation: spec.rotation ?? 0,
            z: ++this.topZ,
            style: { ...DEFAULT_STYLE, ...spec.style },
        };
        this.layers.set(layer.id, layer);
        this.emit();
        return layer;
    }

    addText(spec: AddTextSpec): TextLayer {
        const fontSize = spec.fontSize ?? 48;
        const width = spec.width ?? Math.max(120, spec.text.length * fontSize * 0.5);
        const layer: TextLayer = {
            id: this.newId("txt"),
            kind: "text",
            label: spec.label ?? spec.text.slice(0, 24),
            text: spec.text,
            x: spec.x ?? this.nextSpot().x - width / 2,
            y: spec.y ?? this.nextSpot().y,
            width,
            height: fontSize * 1.25,
            rotation: spec.rotation ?? 0,
            z: ++this.topZ,
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

    update(id: string, patch: LayerPatch): Layer | null {
        const current = this.layers.get(id);
        if (!current) return null;
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
            if (typeof patch.fontSize === "number" && patch.fontSize > 0) {
                next.fontSize = patch.fontSize;
                next.height = patch.fontSize * 1.25;
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
        this.layers.delete(id);
        this.emit();
        return layer;
    }

    addFrame(spec: AddFrameSpec): Frame {
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
        const next: Frame = { ...current, ...stripUndefined(patch) };
        this.frames.set(id, next);
        this.emit();
        return next;
    }

    removeFrame(id: string): Frame | null {
        const frame = this.frames.get(id);
        if (!frame) return null;
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

    private nextSpot(): { x: number; y: number } {
        // A golden-angle spiral, so five images dropped without positions read
        // as five images rather than one stack the agent has to untangle.
        const index = this.counter++;
        const angle = index * 2.399963;
        const radius = 60 + 90 * Math.sqrt(index);
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
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
