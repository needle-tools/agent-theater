/**
 * Turning a picture into shapes.
 *
 * VTracer fits curves to regions of colour, so a cut-out stops being a grid of
 * pixels and becomes a few dozen filled paths. On a collage that is worth
 * having twice over: it prints and exports crisp at any size, and it looks
 * different — flat colour with hard edges, the screen-print end of collage
 * rather than the photographic one.
 *
 * Loaded on demand. The tracer is about 130 kB of WebAssembly and most sessions
 * never trace anything, so it is not in the bundle that draws the first frame;
 * it arrives the first time somebody asks for it and stays for the rest of the
 * session.
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
 * The tracer's own field names, which are camelCase and not documented
 * anywhere the package ships — they are the serde field list inside the wasm.
 * Getting one wrong panics rather than falling back to a default, so the whole
 * struct is always sent.
 */
interface VtracerConfig {
    binary: boolean;
    mode: "spline" | "polygon" | "pixel";
    hierarchical: "stacked" | "cutout";
    cornerThreshold: number;
    lengthThreshold: number;
    maxIterations: number;
    spliceThreshold: number;
    filterSpeckle: number;
    colorPrecision: number;
    layerDifference: number;
    pathPrecision: number;
}

/**
 * Three settings rather than eleven knobs.
 *
 * `filterSpeckle` and `colorPrecision` are the two that actually change the
 * result for a photograph; the rest are curve-fitting details that are fine at
 * their defaults. Naming the choice after what it looks like — flat, balanced,
 * fine — is more use than exposing a speckle radius nobody can predict.
 */
const PRESETS: Record<Required<TraceOptions>["detail"], Pick<VtracerConfig, "filterSpeckle" | "colorPrecision" | "layerDifference">> = {
    flat: { filterSpeckle: 16, colorPrecision: 4, layerDifference: 32 },
    balanced: { filterSpeckle: 6, colorPrecision: 6, layerDifference: 20 },
    fine: { filterSpeckle: 2, colorPrecision: 8, layerDifference: 10 },
};

function configFor(options: TraceOptions): VtracerConfig {
    return {
        binary: false,
        // Splines, not polygons: a traced photo made of straight segments looks
        // like a mistake, where curves look like a decision.
        mode: "spline",
        // Stacked, so a region drawn over another keeps the one beneath whole.
        // Cutout leaves hairline seams between neighbours at some zooms.
        hierarchical: "stacked",
        cornerThreshold: 60,
        lengthThreshold: 4,
        maxIterations: 10,
        spliceThreshold: 45,
        // Two decimal places. Three doubles the file for a difference nobody
        // can see at any size a collage is printed at.
        pathPrecision: 2,
        ...PRESETS[options.detail ?? "balanced"],
    };
}

type Tracer = (pixels: Uint8Array, width: number, height: number, config: unknown) => string;

let loading: Promise<Tracer | null> | null = null;

/** Fetch and start the tracer. Safe to call repeatedly; the work happens once. */
function loadTracer(): Promise<Tracer | null> {
    if (loading) return loading;
    loading = (async () => {
        try {
            const [module, wasmUrl] = await Promise.all([
                import("vtracer-wasm"),
                import("vtracer-wasm/vtracer.wasm?url").then(m => m.default),
            ]);
            await module.default({ module_or_path: wasmUrl });
            return module.to_svg as Tracer;
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
            configFor(options));
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
