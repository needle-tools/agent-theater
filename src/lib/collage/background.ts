/**
 * Removing backgrounds, in this page, with no second window and no agent.
 *
 * The obvious idea is to call FastCut's WebMCP tools. That cannot work, and it
 * is worth being precise about why: `document.modelContext` is a property of
 * *its* document, and a cross-origin document is unreachable from ours by
 * design. WebMCP is an interface for the browser's agent, not a cross-origin
 * RPC channel. There is no flag that changes this.
 *
 * What does work is that FastCut's core is a headless library — "zero DOM
 * dependencies", its own words — so we load that module and call
 * `removeBackground` directly. Same model, same result, no visible UI, and the
 * work happens on the person's own machine.
 *
 * Everything here degrades rather than fails. If the module cannot be loaded,
 * the image is still added, with its background, and the caller is told why —
 * which is also what lets the WebMCP tools suggest FastCut as a fallback
 * instead of silently producing photo-shaped rectangles.
 */

/**
 * Where the library lives. The default points at the deployed FastCut, which
 * needs to serve a *self-contained* browser bundle: its tsup config currently
 * marks `@huggingface/transformers` and `onnxruntime-web` as external, and a
 * browser cannot resolve bare specifiers. Override for local work.
 */
const MODULE_URL =
    import.meta.env.VITE_FASTCUT_MODULE_URL || "https://fastcut.needle.tools/browser.js";

/** Images already this transparent are cut-outs; running a model would be waste. */
const ALREADY_CUT_OUT = 0.95;

interface FastcutModule {
    removeBackground(
        input: Uint8ClampedArray | string,
        width?: number,
        height?: number,
        options?: {
            model?: string;
            format?: "png" | "webp";
            trim?: boolean;
            padding?: number;
            onProgress?: (p: { status: string; file?: string; loaded?: number; total?: number }) => void;
        },
    ): Promise<{ buffer: Uint8Array; width: number; height: number }>;
    loadModel?(key?: string, options?: object): Promise<void>;
}

export type Progress = { status: string; loaded?: number; total?: number };

export interface CutResult {
    ok: boolean;
    blob?: Blob;
    /** Why nothing happened, phrased for a person or an agent to read. */
    reason?: string;
    /** True when the image was already transparent and was left alone. */
    skipped?: boolean;
}

let modulePromise: Promise<FastcutModule | null> | null = null;
let lastError: string | null = null;

/** Load the library once. A failure is remembered, not retried on every drop. */
export function loadFastcut(): Promise<FastcutModule | null> {
    if (modulePromise) return modulePromise;
    modulePromise = import(/* @vite-ignore */ MODULE_URL)
        .then((module: any) => {
            if (typeof module?.removeBackground !== "function") {
                lastError = `${MODULE_URL} loaded but exports no removeBackground().`;
                return null;
            }
            return module as FastcutModule;
        })
        .catch((error: unknown) => {
            lastError =
                `Could not load the background remover from ${MODULE_URL} ` +
                `(${error instanceof Error ? error.message : String(error)}).`;
            return null;
        });
    return modulePromise;
}

export function backgroundRemovalError(): string | null {
    return lastError;
}

/** Warm the model up before anyone drops anything, if the library is there. */
export async function prewarm(onProgress?: (p: Progress) => void): Promise<boolean> {
    const fastcut = await loadFastcut();
    if (!fastcut?.loadModel) return false;
    try {
        await fastcut.loadModel("rmbg", { onProgress });
        return true;
    } catch (error) {
        lastError = `The background-removal model could not be loaded (${message(error)}).`;
        return false;
    }
}

/**
 * Cut the background out of an image.
 *
 * `coverage` is the fraction of the source that is already opaque — pass it
 * when it is known, and an image that is already a cut-out is returned
 * untouched instead of being run through a model for nothing.
 */
export async function removeBackground(
    blob: Blob,
    options: { coverage?: number; onProgress?: (p: Progress) => void } = {},
): Promise<CutResult> {
    if (options.coverage !== undefined && options.coverage < ALREADY_CUT_OUT) {
        return { ok: false, skipped: true, reason: "It is already a cut-out — left as it is." };
    }

    const fastcut = await loadFastcut();
    if (!fastcut) {
        return {
            ok: false,
            reason:
                (lastError ?? "The background remover is unavailable.") +
                ` Cut it at https://fastcut.needle.tools instead and pass the result back.`,
        };
    }

    try {
        const pixels = await decode(blob);
        const result = await fastcut.removeBackground(pixels.data, pixels.width, pixels.height, {
            format: "png",
            // Trim the transparent margin the model leaves behind: it shrinks
            // what goes into IndexedDB, and the layout crops to the shape anyway.
            trim: true,
            onProgress: options.onProgress,
        });
        if (!result?.buffer?.byteLength) return { ok: false, reason: "The background remover returned nothing." };
        // Copy into a fresh ArrayBuffer: the result may be a view onto a larger
        // WASM heap buffer, and handing that straight to Blob() would capture
        // far more than the image.
        return { ok: true, blob: new Blob([new Uint8Array(result.buffer)], { type: "image/png" }) };
    } catch (error) {
        return { ok: false, reason: `Background removal failed: ${message(error)}` };
    }
}

/** Blob to raw RGBA. `createImageBitmap` avoids a round trip through an <img>. */
async function decode(blob: Blob): Promise<ImageData> {
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2D context");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
