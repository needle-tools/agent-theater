/**
 * Will this actually look right when it leaves the screen?
 *
 * A cut-out that reads as crisp in a 900-pixel preview can be a smear on an A4
 * page, because A4 at 300 dpi is 2480 pixels across and nothing on screen ever
 * told anyone that. Nobody finds out until it is printed.
 *
 * So the check is explicit, and — more importantly — it is reported to the
 * agent, in `collage_describe` and again when it exports. An agent that is told
 * "this cut-out is 412 px in a slot that needs 1200" can go back to FastCut and
 * re-cut from the original at full size. An agent that is told nothing ships a
 * blurry poster.
 */
import { outputSize, type Frame, type ImageLayer, type Layer } from "./model.js";

export type Verdict = "good" | "soft" | "poor";

export interface LayerQuality {
    id: string;
    label: string;
    /** Pixels of the source actually used, after cropping to the alpha box. */
    sourcePixels: { width: number; height: number };
    /** Pixels this layer occupies in the export. */
    renderedPixels: { width: number; height: number };
    /** Source ÷ rendered. Below 1 means the pixels are being stretched. */
    pixelRatio: number;
    /** Only meaningful for paper frames; null for screen targets. */
    effectiveDpi: number | null;
    verdict: Verdict;
    message: string | null;
}

export interface FrameQuality {
    frameId: string;
    dpi: number;
    output: { width: number; height: number };
    layers: LayerQuality[];
    worst: Verdict;
    /** One line an agent can relay, or null when everything is fine. */
    summary: string | null;
}

/** Below this, upscaling starts to show on screen. */
const SCREEN_SOFT = 0.75;
const SCREEN_POOR = 0.5;
/** Print thresholds. 300 is the ideal; 220 still looks sharp at arm's length. */
const PRINT_GOOD_DPI = 220;
const PRINT_SOFT_DPI = 150;

export function checkFrame(layers: Layer[], frame: Frame, dpi = 300): FrameQuality {
    const output = outputSize(frame, dpi);
    const scale = output.width / frame.width;
    const images = layers.filter((l): l is ImageLayer => l.kind === "image");

    const checked = images.map(layer => check(layer, frame, output, scale, dpi));
    const worst = checked.reduce<Verdict>((acc, l) =>
        l.verdict === "poor" || acc === "poor" ? "poor" : l.verdict === "soft" || acc === "soft" ? "soft" : "good",
        "good");

    const problems = checked.filter(l => l.verdict !== "good");
    const summary = problems.length
        ? `${problems.length} of ${checked.length} image(s) will look soft at ${output.width}×${output.height}: ` +
          problems.map(p => p.label).join(", ") + ". Re-cut them from a larger source, or scale them down in the frame."
        : null;

    return { frameId: frame.id, dpi, output, layers: checked, worst, summary };
}

function check(
    layer: ImageLayer,
    frame: Frame,
    output: { width: number; height: number },
    scale: number,
    dpi: number,
): LayerQuality {
    const sourcePixels = {
        width: Math.round(layer.natural.width * layer.crop.width),
        height: Math.round(layer.natural.height * layer.crop.height),
    };
    const renderedPixels = {
        width: Math.round(layer.width * scale),
        height: Math.round(layer.height * scale),
    };
    const pixelRatio = renderedPixels.width > 0 ? sourcePixels.width / renderedPixels.width : 1;

    if (frame.physical) {
        // Inches of paper this layer covers, then the dpi its own pixels supply.
        const inches = (frame.physical.width * (layer.width / frame.width)) / 25.4;
        const effectiveDpi = inches > 0 ? Math.round(sourcePixels.width / inches) : 0;
        const verdict: Verdict =
            effectiveDpi >= PRINT_GOOD_DPI ? "good" : effectiveDpi >= PRINT_SOFT_DPI ? "soft" : "poor";
        return {
            id: layer.id,
            label: layer.label,
            sourcePixels,
            renderedPixels,
            pixelRatio: round2(pixelRatio),
            effectiveDpi,
            verdict,
            message: verdict === "good"
                ? null
                : `"${layer.label}" is ${sourcePixels.width}×${sourcePixels.height} but needs about ` +
                  `${renderedPixels.width}×${renderedPixels.height} to print at ${dpi} dpi ` +
                  `(${effectiveDpi} dpi effective).`,
        };
    }

    const verdict: Verdict = pixelRatio >= SCREEN_SOFT ? "good" : pixelRatio >= SCREEN_POOR ? "soft" : "poor";
    return {
        id: layer.id,
        label: layer.label,
        sourcePixels,
        renderedPixels,
        pixelRatio: round2(pixelRatio),
        effectiveDpi: null,
        verdict,
        message: verdict === "good"
            ? null
            : `"${layer.label}" is ${sourcePixels.width}×${sourcePixels.height} but is drawn at ` +
              `${renderedPixels.width}×${renderedPixels.height} — it is being upscaled ${round2(1 / pixelRatio)}×.`,
    };
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
