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

/**
 * The deployment that tracks FastCut's builds, not the vanity domain.
 *
 * `fastcut.needle.tools` resolves to the project's *promoted* deployment, which
 * only moves when somebody promotes it — so a capability added to the handoff
 * this morning may not be there for weeks, and the page would quietly fall back
 * as though FastCut simply could not do it. The `-latest` address follows CI, so
 * this and the handoff it talks to are always the same generation.
 *
 * The cost is a cold cache: the ~40 MB of model weights are cached per origin,
 * so a visitor who has used fastcut.needle.tools does not arrive warm here. That
 * is the right trade while the two are still moving — a slow first cut-out beats
 * a missing feature — and it stops mattering the day the vanity domain gains the
 * `-latest` label too.
 *
 * A directory, not a `.html` file. The deploy does not route bare top-level HTML
 * files — they 404, and the path then falls through to FastCut's app, which
 * would boot the whole editor in the frame and never answer.
 */
const DEFAULT_HANDOFF_URL = "https://remove-background-zubckszla3jp-latest.needle.run/handoff/";

/**
 * Where the handoff lives.
 *
 * `?fastcut=…` overrides it, so a local FastCut can be tried without a rebuild
 * or an env var — but only pointing at localhost or needle.tools. The override
 * arrives in a URL, and a link is something anyone can send: without the check
 * one could aim a person's cut-outs at a server of their choosing.
 */
function resolveHandoffUrl(): string {
    const fallback = import.meta.env.VITE_FASTCUT_HANDOFF_URL || DEFAULT_HANDOFF_URL;
    if (typeof location === "undefined") return fallback;
    try {
        const override = new URLSearchParams(location.search).get("fastcut");
        if (!override) return fallback;
        const url = new URL(override, location.href);
        const trusted =
            /^(localhost|127\.0\.0\.1)$/.test(url.hostname) ||
            /(^|\.)needle\.tools$/.test(url.hostname) ||
            // Needle Cloud gives every deployment its own needle.run address,
            // which is how a build is tried before a domain points at it.
            /(^|\.)needle\.run$/.test(url.hostname);
        if (!trusted) {
            console.warn(`[collage] ignoring ?fastcut=${override} — only localhost or needle.tools.`);
            return fallback;
        }
        return url.href;
    } catch {
        return fallback;
    }
}

const HANDOFF_URL = resolveHandoffUrl();

const CHANNEL = "fastcut";
/** Long enough for a cold model download on a slow line, short enough to give up. */
const READY_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 180_000;
/** Images already this transparent are cut-outs; running a model would be waste. */
const ALREADY_CUT_OUT = 0.95;

/**
 * The smallest thing worth calling an object, as a fraction of the shorter edge.
 *
 * FastCut's own floor is an absolute 100 pixels, which cannot be right for both
 * a 400px thumbnail and a 12-megapixel photo: on the photo it keeps every fleck
 * of model noise as its own "object", and the caller gets forty layers of dust.
 * A fraction of the image is the scale-free version of the same idea — anything
 * narrower than about a fiftieth of the frame is debris, whatever the camera.
 */
const SMALLEST_PIECE = 0.02;

/** Area in pixels below which a detected island is speckle rather than a thing. */
export function smallestPiece(width: number, height: number): number {
    const side = SMALLEST_PIECE * Math.min(width, height);
    // An 8×8 floor, so a genuinely tiny source still slices instead of
    // collapsing to a threshold that excludes everything in it.
    return Math.max(64, Math.round(side * side));
}

export type Progress = { status?: string; loaded?: number; total?: number };

/** One object found in a photo, with where it was found. */
export interface CutPiece {
    blob: Blob;
    /** Its box in the source image's own pixels, so it can go back where it was. */
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CutResult {
    ok: boolean;
    blob?: Blob;
    /**
     * The separate objects, when the photo turned out to hold more than one.
     * Absent for a single cut-out, which is the ordinary case.
     */
    pieces?: CutPiece[];
    /**
     * The scene with its objects painted out, when one was asked for and could
     * be made. Slicing says what was in the photo; this says what was behind
     * them, which is what turns one flat picture into a background and a set of
     * things that can be moved around on it.
     */
    backplate?: Blob;
    /** The size the pieces' boxes are measured against. */
    source?: { width: number; height: number };
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
        if (data.ok && Array.isArray(data.pieces) && data.pieces.length > 1) {
            waiting.resolve({
                ok: true,
                pieces: data.pieces.map((piece: any) => ({
                    blob: new Blob([piece.png], { type: "image/png" }),
                    x: piece.x ?? 0,
                    y: piece.y ?? 0,
                    width: piece.boxWidth ?? piece.width ?? 1,
                    height: piece.boxHeight ?? piece.height ?? 1,
                })),
                source: { width: data.width, height: data.height },
                ...(data.backplate
                    ? { backplate: new Blob([data.backplate], { type: "image/png" }) }
                    : {}),
            });
        } else if (data.ok && data.png) {
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
    options: {
        coverage?: number;
        onProgress?: (p: Progress) => void;
        /**
         * Ask for the separate objects when the photo holds more than one.
         *
         * Needs `size`, because the threshold for "an object rather than a
         * fleck" is a fraction of the image and cannot be guessed from bytes.
         */
        slice?: boolean;
        size?: { width: number; height: number };
        /**
         * Also ask for the scene with its objects painted out.
         *
         * Off unless asked: it is a second model, about 28 MB, and a slow pass
         * on top of the cut-out. Only meaningful alongside `slice`.
         */
        heal?: boolean;
    } = {},
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
            // `slice` and `minPixels` are ignored by a handoff that predates
            // them, which then answers with the single cut-out it always did —
            // so asking costs nothing against an older deployment.
            const slice = options.slice === true && !!options.size;
            frame.contentWindow!.postMessage(
                {
                    channel: CHANNEL,
                    type: "remove-background",
                    id,
                    image,
                    trim: true,
                    ...(slice
                        ? {
                            slice: true,
                            minPixels: smallestPiece(options.size!.width, options.size!.height),
                            ...(options.heal ? { heal: true } : {}),
                        }
                        : {}),
                },
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
