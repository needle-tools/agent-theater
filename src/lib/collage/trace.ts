/**
 * Turning a picture into shapes.
 *
 * VTracer fits curves to regions of colour, so a cut-out stops being a grid of
 * pixels and becomes a few dozen filled paths. On a collage that is worth
 * having twice over: it prints and exports crisp at any size, and it looks
 * different — flat colour with hard edges, the screen-print end of collage
 * rather than the photographic one.
 *
 * Loaded on demand. The tracer is about 650 kB of WebAssembly and most sessions
 * never trace anything, so it is not in the bundle that draws the first frame;
 * it arrives the first time somebody asks for it and stays for the rest of the
 * session. See vendor/vtracer/README.md for why it is vendored.
 *
 * Everything here is one call into wasm and back. The interesting decisions are
 * in the settings below, not in the plumbing.
 */
import type { Pixels } from "./imaging.js";

export interface TraceOptions {
    /**
     * How much to smooth away. Higher discards more small regions, which is
     * what separates "an illustration of a cactus" from "four thousand paths
     * describing every speck of JPEG noise".
     */
    detail?: "flat" | "balanced" | "fine";
}

/**
 * What each named choice actually asks for.
 *
 * Two things were learned the hard way here, and both are worth keeping.
 *
 * The `poster` preset is the whole game. Driving the raw knobs — colour
 * precision, layer difference — collapses a photograph to a single flat region
 * no matter how they are set: measured on a gradient, raw knobs at every
 * setting gave 1 path, `poster` gave 439.
 *
 * And `filterSpeckle` is the only one that governs how *many* shapes come out.
 * `maxColors` barely moves it — at a fixed speckle, asking for 6 colours or 24
 * changed the count by 14 paths. Speckle changed it by a factor of thirty.
 * Measured on an illustration at the size these are traced at:
 *
 *     speckle   6 →  2762 paths, 1040 kB   (this was the default, and it
 *     speckle  16 →  1223 paths,  703 kB    made the canvas crawl)
 *     speckle  64 →    85 paths,  256 kB
 *     speckle 128 →    30 paths,  145 kB
 *
 * Every one of those is a legible picture. The high end is not a degraded
 * version of the low end — it is the same illustration with the noise left out.
 */
const PRESETS: Record<Required<TraceOptions>["detail"], { speckle: number; maxColors: number; simplify: number }> = {
    // Few, large, flat shapes — the screen-print end of it.
    flat: { speckle: 128, maxColors: 8, simplify: 2.5 },
    balanced: { speckle: 64, maxColors: 16, simplify: 2 },
    // Follows the picture closely, and costs a much heavier layer for it.
    fine: { speckle: 28, maxColors: 32, simplify: 1.2 },
};

function configFor(options: TraceOptions, longestEdge: number): Record<string, unknown> {
    const preset = PRESETS[options.detail ?? "balanced"];
    return {
        preset: "poster",
        maxColors: preset.maxColors,
        simplify: preset.simplify,
        // Speckle is a pixel count, so it has to follow the size actually
        // traced or a small picture loses everything and a large one keeps
        // every fleck. Tuned at TRACE_EDGE; scaled from there.
        filterSpeckle: Math.max(4, Math.round(preset.speckle * (longestEdge / TRACE_EDGE))),
        // Splines, not polygons: a traced photo made of straight segments looks
        // like a mistake, where curves look like a decision.
        mode: "spline",
        // Two decimal places. Three doubles the file for a difference nobody
        // can see at any size a collage is printed at.
        pathPrecision: 2,
    };
}

/** The longest edge the presets above were measured at. */
export const TRACE_EDGE = 1100;

type Tracer = (rgba: Uint8Array, width: number, height: number, options: unknown) => string;

let loading: Promise<Tracer | null> | null = null;

/** Fetch and start the tracer. Safe to call repeatedly; the work happens once. */
function loadTracer(): Promise<Tracer | null> {
    if (loading) return loading;
    loading = (async () => {
        try {
            const [module, wasmUrl] = await Promise.all([
                import("$lib/vendor/vtracer/vtracer.js"),
                import("$lib/vendor/vtracer/vtracer.wasm?url").then(m => m.default),
            ]);
            await module.init(fetch(wasmUrl));
            return module.vectorize_rgba as Tracer;
        } catch (error) {
            // A tracer that will not load costs a menu item, not the canvas.
            console.warn("[collage] the tracer could not be loaded:", error);
            return null;
        }
    })();
    return loading;
}

export interface TraceResult {
    svg: string;
    /** How many filled paths it came out as — the honest measure of "how vector". */
    paths: number;
}

/**
 * Trace pixels into an SVG.
 *
 * Returns null when the tracer is unavailable or the image defeats it, so a
 * caller can say so rather than replacing a picture with nothing.
 */
export async function traceToSvg(pixels: Pixels, options: TraceOptions = {}): Promise<TraceResult | null> {
    const trace = await loadTracer();
    if (!trace) return null;
    try {
        const svg = trace(
            new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
            pixels.width,
            pixels.height,
            configFor(options, Math.max(pixels.width, pixels.height)));
        const paths = (svg.match(/<path/g) ?? []).length;
        // No paths means every region was filtered away — a blank SVG is worse
        // than the photograph it would have replaced.
        return paths ? { svg, paths } : null;
    } catch (error) {
        console.warn("[collage] tracing failed:", error);
        return null;
    }
}

/**
 * The traced SVG as a blob, ready to be a layer's source.
 *
 * `image/svg+xml` rather than a data: URL, so it goes into IndexedDB with
 * everything else and survives a reload by the same route.
 */
export function svgBlob(svg: string): Blob {
    return new Blob([svg], { type: "image/svg+xml" });
}
