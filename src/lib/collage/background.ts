/**
 * Removing backgrounds, in this page, with no second window and no agent.
 *
 * The obvious idea is to call FastCut's WebMCP tools. That cannot work, and the
 * reason is worth stating once properly: `registerTool` is not an export. It
 * hands a capability to the *browser*, for the browser's agent, while the user
 * is on that page. Calling it would mean reaching `document.modelContext` on
 * FastCut's document from ours, and the same-origin policy forbids touching any
 * property of a cross-origin document — WebMCP or otherwise. An agent can drive
 * FastCut in a tab because an agent is browser-level. A website is not.
 *
 * What does cross origins is postMessage, and only where the other page
 * listens. So FastCut serves a UI-less `handoff.html` that does, and this loads
 * it in a hidden iframe: same frame, different door.
 *
 * Doing it there rather than importing a library here also means the model and
 * its ~40 MB of weights are cached on FastCut's origin — warm already for
 * anyone who has used FastCut, instead of downloaded a second time for us.
 *
 * Everything degrades rather than fails. If the frame never answers, the image
 * is still added, with its background, and the caller is told why — which is
 * what lets the WebMCP tools name a fallback instead of silently producing
 * photo-shaped rectangles.
 */

const HANDOFF_URL =
    import.meta.env.VITE_FASTCUT_HANDOFF_URL || "https://fastcut.needle.tools/handoff.html";

const CHANNEL = "fastcut";
/** Long enough for a cold model download on a slow line, short enough to give up. */
const READY_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 180_000;
/** Images already this transparent are cut-outs; running a model would be waste. */
const ALREADY_CUT_OUT = 0.95;

export type Progress = { status?: string; loaded?: number; total?: number };

export interface CutResult {
    ok: boolean;
    blob?: Blob;
    /** Why nothing happened, phrased for a person or an agent to read. */
    reason?: string;
    /** True when the image was already transparent and was left alone. */
    skipped?: boolean;
}

interface Pending {
    resolve: (value: CutResult) => void;
    onProgress?: (p: Progress) => void;
}

let framePromise: Promise<HTMLIFrameElement | null> | null = null;
let lastError: string | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

/** The handoff's origin, for addressing messages and checking replies. */
function handoffOrigin(): string {
    try {
        return new URL(HANDOFF_URL, location.href).origin;
    } catch {
        return "*";
    }
}

/**
 * Create the hidden frame once and wait for it to say it is ready.
 *
 * A failure is remembered rather than retried on every drop — a 404 will still
 * be a 404 for the next image, and re-testing it each time just makes dropping
 * a folder slow.
 */
function openHandoff(): Promise<HTMLIFrameElement | null> {
    if (framePromise) return framePromise;
    framePromise = new Promise(resolve => {
        if (typeof document === "undefined") return resolve(null);

        const frame = document.createElement("iframe");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("title", "FastCut background removal");
        // Scripts, and same-origin *to itself* so it can reach its own caches
        // and workers. It stays a different origin from us either way.
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
        frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;";

        let settled = false;
        const finish = (value: HTMLIFrameElement | null, reason?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            window.removeEventListener("message", onReady);
            if (reason) lastError = reason;
            if (!value) frame.remove();
            resolve(value);
        };

        const onReady = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow) return;
            if (event.data?.channel !== CHANNEL || event.data?.type !== "ready") return;
            finish(frame);
        };

        const timer = setTimeout(
            () => finish(null,
                `The background remover at ${HANDOFF_URL} did not respond. ` +
                `It may not be deployed yet.`),
            READY_TIMEOUT_MS);

        window.addEventListener("message", onReady);
        frame.onerror = () => finish(null, `The background remover at ${HANDOFF_URL} could not be loaded.`);
        frame.src = HANDOFF_URL;
        document.body.appendChild(frame);
    });
    return framePromise;
}

/** One listener for every reply, dispatched by request id. */
function listen() {
    if (typeof window === "undefined" || (listen as any).installed) return;
    (listen as any).installed = true;
    const origin = handoffOrigin();
    window.addEventListener("message", (event: MessageEvent) => {
        if (origin !== "*" && event.origin !== origin) return;
        const data = event.data;
        if (!data || data.channel !== CHANNEL) return;
        const waiting = pending.get(data.id);
        if (!waiting) return;

        if (data.type === "progress") {
            waiting.onProgress?.({ status: data.status, loaded: data.loaded, total: data.total });
            return;
        }
        if (data.type !== "result") return;
        pending.delete(data.id);
        if (data.ok && data.png) {
            waiting.resolve({ ok: true, blob: new Blob([data.png], { type: "image/png" }) });
        } else {
            waiting.resolve({ ok: false, reason: data.error ?? "The background remover returned nothing." });
        }
    });
}

export function backgroundRemovalError(): string | null {
    return lastError;
}

/** Open the frame early, so the first drop is not also the first connection. */
export async function prewarm(): Promise<boolean> {
    listen();
    return !!(await openHandoff());
}

/**
 * Cut the background out of an image.
 *
 * `coverage` is the fraction of the source that is already opaque — pass it
 * when it is known, and an image that is already a cut-out is returned
 * untouched instead of being sent across for nothing.
 */
export async function removeBackground(
    blob: Blob,
    options: { coverage?: number; onProgress?: (p: Progress) => void } = {},
): Promise<CutResult> {
    if (options.coverage !== undefined && options.coverage < ALREADY_CUT_OUT) {
        return { ok: false, skipped: true, reason: "It is already a cut-out — left as it is." };
    }

    listen();
    const frame = await openHandoff();
    if (!frame?.contentWindow) {
        return {
            ok: false,
            reason:
                (lastError ?? "The background remover is unavailable.") +
                ` Cut it at https://fastcut.needle.tools instead and pass the result back.`,
        };
    }

    const id = ++nextId;
    const image = await blob.arrayBuffer();

    return new Promise<CutResult>(resolve => {
        const finish = (result: CutResult) => {
            clearTimeout(timer);
            pending.delete(id);
            resolve(result);
        };
        const timer = setTimeout(
            () => finish({ ok: false, reason: "The background remover took too long and was given up on." }),
            REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve: finish, onProgress: options.onProgress });
        try {
            frame.contentWindow!.postMessage(
                { channel: CHANNEL, type: "remove-background", id, image, trim: true },
                handoffOrigin(),
                [image]);
        } catch (error) {
            finish({ ok: false, reason: `Could not reach the background remover: ${message(error)}` });
        }
    });
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
