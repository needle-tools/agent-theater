/**
 * Reading images, and reading the *shape* inside them.
 *
 * A cut-out is an image plus an alpha channel, and the alpha channel is more
 * useful than it first looks. It gives us the tight bounding box — which is why
 * a PNG that is 80% empty space still lays out as the sneaker you can see, not
 * as the transparent rectangle around it — and it gives us a silhouette, an
 * outline and a shadow without FastCut needing to export any of those
 * separately.
 *
 * The analysis functions at the bottom take plain `{data, width, height}` and
 * touch no browser API, so they are testable in node. The loading at the top is
 * unavoidably browser-side.
 */
import type { CropBox } from "./model.js";

export interface LoadedImage {
    src: string;
    image: HTMLImageElement;
    width: number;
    height: number;
    /**
     * True when the pixels could not be read back — a cross-origin image served
     * without CORS headers still *displays*, but it taints a canvas, so preview
     * and PNG export are impossible. Better to know at load than at export.
     */
    tainted: boolean;
    /** Tight alpha bounds, or the full rect for an opaque image. */
    crop: CropBox;
    /** A few representative colours, most common first. */
    colors: string[];
    /** Fraction of pixels with meaningful alpha — near 1 means "not a cut-out". */
    coverage: number;
}

/** Pixels below this alpha are treated as empty when measuring the shape. */
const ALPHA_THRESHOLD = 12;
/** Analysis runs on a thumbnail; the bounding box does not need every pixel. */
const ANALYSIS_SIZE = 256;

export async function loadImage(src: string): Promise<LoadedImage> {
    const image = await decode(src);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("The image loaded but has no size.");

    let tainted = false;
    let crop: CropBox = { x: 0, y: 0, width: 1, height: 1 };
    let colors: string[] = [];
    let coverage = 1;

    try {
        const sample = sampleImage(image, width, height);
        crop = alphaBounds(sample);
        colors = dominantColors(sample);
        coverage = alphaCoverage(sample);
    } catch {
        // A SecurityError here means cross-origin pixels. Everything still
        // works except reading them back, so carry on with the full rect.
        tainted = true;
    }

    return { src, image, width, height, tainted, crop, colors, coverage };
}

function decode(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // Remote images need this to stay readable; a server that ignores it
        // leaves us with a tainted canvas, which `loadImage` handles above.
        if (!src.startsWith("data:") && !src.startsWith("blob:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load the image at ${short(src)}.`));
        image.src = src;
    });
}

export interface Pixels {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

function sampleImage(image: CanvasImageSource, width: number, height: number): Pixels {
    const scale = Math.min(1, ANALYSIS_SIZE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No 2D context available.");
    ctx.drawImage(image, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

/**
 * The alpha bounding box, as fractions of the image.
 *
 * A fully opaque image returns the full rect, which is the right answer for a
 * photo and costs one pass to find out.
 */
export function alphaBounds(pixels: Pixels): CropBox {
    const { data, width, height } = pixels;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    // Nothing visible at all: keep the full rect rather than returning a
    // degenerate box that would divide by zero downstream.
    if (maxX < 0) return { x: 0, y: 0, width: 1, height: 1 };
    // One pixel of margin on each side, because the sample is a thumbnail and
    // its edges are the original's edges rounded inward.
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(width - 1, maxX + 1);
    maxY = Math.min(height - 1, maxY + 1);
    return {
        x: minX / width,
        y: minY / height,
        width: (maxX - minX + 1) / width,
        height: (maxY - minY + 1) / height,
    };
}

/** Fraction of pixels that are not transparent. */
export function alphaCoverage(pixels: Pixels): number {
    const { data } = pixels;
    let visible = 0;
    const total = data.length / 4;
    for (let i = 3; i < data.length; i += 4) if (data[i] > ALPHA_THRESHOLD) visible++;
    return total ? visible / total : 0;
}

/**
 * A handful of representative colours, most common first.
 *
 * Coarse 4-bit-per-channel bucketing rather than k-means: the point is to give
 * an agent something to build a palette from ("the shoe is mostly rust and
 * cream"), not to be a colour science library.
 */
export function dominantColors(pixels: Pixels, count = 4): string[] {
    const { data } = pixels;
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= 128) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.count++;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
        } else {
            buckets.set(key, { count: 1, r, g, b });
        }
    }
    return [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, count)
        .map(b => hex(Math.round(b.r / b.count), Math.round(b.g / b.count), Math.round(b.b / b.count)));
}

function hex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function short(src: string): string {
    return src.length > 80 ? `${src.slice(0, 77)}…` : src;
}

/** Re-encode an image as a data URI, for a snippet that carries its own assets. */
export async function toDataUrl(image: HTMLImageElement, type = "image/png", quality?: number): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context available.");
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL(type, quality);
}
