import type { CollageStudio } from "./studio.js";
import type { StoredDoc } from "./persistence.js";
import type { WebMcpToolDef } from "./tools.js";
import { MissingImageAssetError } from "./persistence.js";
import { track } from "../telemetry.js";
import { unfurlCharacters, unfurlWebp } from "./shareCard.js";
import { playLanguage } from "./language.js";

export const TOKEN_PREFIX = "needle-play/edit/";
export const CURRENT_PLAY_KEY = "needle-play/current";
export const CURRENT_PLAY_CHANGED = "needle-play-current-changed";

/** Clearing the stage starts a new work, so a later save must create a new row. */
export function forgetCurrentPlay(): void {
    try { localStorage.removeItem(CURRENT_PLAY_KEY); } catch { /* Storage is optional. */ }
    try { window.dispatchEvent(new CustomEvent(CURRENT_PLAY_CHANGED, { detail: null })); } catch { /* SSR */ }
}

export interface PublishedPlay {
    id: string;
    title: string;
    visibility: "public" | "unlisted";
    url: string;
    language?: string;
    created_at?: string;
    updated_at?: string;
}

async function webp(blob: Blob): Promise<Blob> {
    const image = await createImageBitmap(blob);
    let scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    for (const quality of [0.88, 0.8, 0.7, 0.6]) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encoded = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(value => value ? resolve(value) : reject(new Error("WebP encoding failed.")), "image/webp", quality));
        if (encoded.size <= 1_048_576) { image.close(); return encoded; }
        scale *= 0.82;
    }
    image.close();
    throw new Error("An image could not be reduced below the 1 MB publishing limit.");
}

async function json(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new PublishHttpError(body.error || `Server returned ${response.status}.`, response.status);
    return body;
}

class PublishHttpError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

/** Upgrade old browser-only layers into uploadable assets for this publication. */
export async function preparePlayAssets(
    doc: StoredDoc,
    local: Array<{ key: string; blob: Blob }>,
    fetchSource: (url: string) => Promise<Blob | null>,
): Promise<{ doc: StoredDoc; local: Array<{ key: string; blob: Blob }> }> {
    const assets = [...local];
    const keys = new Set(assets.map(asset => asset.key));
    const sources = new Map<string, string>();
    const layers = [] as StoredDoc["layers"];
    for (const layer of doc.layers) {
        // Sheet URLs expire after two hours. A published play must own a
        // permanent copy, just as it does for browser-only blob images.
        if (layer.kind !== "image" || layer.storageKey || !/^(blob:|data:image\/|(?:https?:\/\/[^/]+)?\/api\/sheets\/)/i.test(layer.src)) {
            layers.push(layer);
            continue;
        }
        let key = sources.get(layer.src);
        if (!key) {
            const blob = await fetchSource(layer.src);
            if (!blob?.size) throw new MissingImageAssetError();
            key = `publish-local-${sources.size}`;
            while (keys.has(key)) key += "-";
            sources.set(layer.src, key);
            keys.add(key);
            assets.push({ key, blob });
        }
        layers.push({ ...layer, src: "", storageKey: key });
    }
    return { doc: { ...doc, layers }, local: assets };
}

async function publishResponse(response: Response, by: "human" | "agent") {
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        track("play_publish_refused", {
            by,
            reason: "rate_limit",
            status: response.status,
            retry_after: Number.isFinite(retryAfter) ? retryAfter : undefined,
        });
    }
    return json(response);
}

export function playId(value: string): string | null {
    return value.trim().match(/(?:\/p\/)?([A-Za-z0-9_-]{10,40})\/?(?:[?#].*)?$/)?.[1] ?? null;
}

export function canEditPlay(id: string): boolean {
    try { return !!localStorage.getItem(TOKEN_PREFIX + id); } catch { return false; }
}

export async function savePlayOnline(
    studio: CollageStudio,
    options: { id?: string; title?: string } = {},
    by: "human" | "agent" = "human",
): Promise<PublishedPlay> {
    let phase = "collect_assets";
    try {
    const assets: Record<string, string> = {};
    const prepared = await preparePlayAssets(studio.storedDoc!(), await studio.storedAssets!(), async src => {
        try {
            const response = await fetch(src);
            return response.ok ? response.blob() : null;
        } catch { return null; }
    });
    const local = prepared.local;
    if (local.length > 40) throw new Error("A play can publish at most 40 custom images.");
    const title = (options.title || studio.collage.billing.title || "Untitled play").slice(0, 160);
    let total = 0;
    for (const asset of local) {
        phase = "encode_image";
        const encoded = await webp(asset.blob);
        total += encoded.size;
        if (total > 12_582_912) throw new Error("Custom images exceed the 12 MB per-play limit.");
        phase = "upload_image";
        const uploaded = await json(await fetch("/api/assets", {
            method: "POST", headers: { "content-type": "image/webp" }, body: encoded,
        }));
        assets[asset.key] = uploaded.sha;
    }
    let cardSha: string | undefined;
    if (typeof FontFace !== "undefined" && document.fonts) {
        try {
            const characters = unfurlCharacters({ ...prepared.doc, layers: studio.collage.listAll() });
            const card = await unfurlWebp(title, characters);
            const uploaded = await json(await fetch("/api/assets", {
                method: "POST", headers: { "content-type": "image/webp" }, body: card,
            }));
            cardSha = uploaded.sha;
        } catch (error) {
            console.warn("[unfurl] Could not publish the share image.", error);
            track("play_unfurl_failed", { by, phase: "generate_or_upload" });
        }
    }
    const id = options.id;
    const token = id ? localStorage.getItem(TOKEN_PREFIX + id) : null;
    phase = "save_play";
    const result = await publishResponse(await fetch(id ? `/api/plays/${encodeURIComponent(id)}` : "/api/plays", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
            title,
            visibility: "public",
            doc: prepared.doc, assets, cardSha,
            language: playLanguage(prepared.doc.billing?.language),
        }),
    }), by) as PublishedPlay & { editToken?: string };
    if (result.editToken) localStorage.setItem(TOKEN_PREFIX + result.id, result.editToken);
    // A play leaving the tab is the moment somebody decided it was worth
    // keeping. Its shape, never its title — that is theirs.
    track("play_saved", {
        by,
        published: true,
        updated: !!id,
        images: local.length,
        chapters: studio.collage.listStages().length,
        pieces: studio.collage.listAll().length,
    });
    return result;
    } catch (error) {
        // Rybbit receives a category and phase, never a server message, title,
        // image URL, or other content from the person's play.
        track("play_save_failed", {
            by, published: true, phase,
            reason: error instanceof MissingImageAssetError ? "missing_local_image"
                : error instanceof PublishHttpError && error.message === "Invalid or incomplete asset map."
                    ? "asset_map_rejected"
                : error instanceof Error && /limit|exceed/i.test(error.message) ? "limit"
                : phase === "collect_assets" ? "local_asset_error"
                : phase === "encode_image" ? "encode_error"
                : phase === "upload_image" ? "image_upload_error" : "play_request_error",
            ...(error instanceof PublishHttpError ? { status: error.status } : {}),
        });
        throw error;
    }
}

export async function listPublicPlays(limit = 20): Promise<PublishedPlay[]> {
    const data = await json(await fetch(`/api/plays?limit=${Math.max(1, Math.min(50, limit))}`));
    return data.plays as PublishedPlay[];
}

export async function loadPlayOnline(studio: CollageStudio, value: string): Promise<{ play: PublishedPlay; layers: number }> {
    const id = playId(value);
    if (!id) throw new Error("Enter a play link or id.");
    const play = await json(await fetch(`/api/plays/${encodeURIComponent(id)}`));
    const layers = await studio.loadPublished!(play.doc as StoredDoc);
    track("play_loaded", { by: "human", source: "online", pieces: layers });
    return { play: { ...play, id, url: `${location.origin}/p/${id}` }, layers };
}

export function publishingTools(studio: CollageStudio): WebMcpToolDef[] {
    const publish: WebMcpToolDef = {
        name: "show_publish",
        title: "Publish this play",
        annotations: { readOnlyHint: false, consequentialHint: true },
        description: "Upload the current play and its custom images to the theater server as public, " +
            "then return its share URL. Only plays with a script appear in the community " +
            "library. Supply an existing id to update that play. This is an online publication.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Existing play id to update. Omit to create one." },
                title: { type: "string", description: "Library title. Defaults to the play's title card." },
            },
        },
        async execute(args: { id?: string; title?: string }) {
            try {
                const id = typeof args?.id === "string" ? args.id : undefined;
                const result = await savePlayOnline(studio, { id, title: args?.title }, "agent");
                return { content: [{ type: "text", text: `Published “${result.title}”. Share: ${result.url}` }], structuredContent: result };
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                return { content: [{ type: "text", text: `Could not save the play: ${reason}` }], isError: true };
            }
        },
    };

    return [publish, {
        name: "show_list",
        title: "List published plays",
        description: "Find public scripted plays made here — id, title, how many chapters, how long, "
            + "which troupe packs, and the shareable URL. Arrangements and tableaux without "
            + "scripted beats remain available by direct link, but are not listed. "
            + "Narrow with title, theme, chapter count or length before loading anything.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "1–50, default 20." },
                title: { type: "string", description: "Match anywhere in the title, case-insensitive." },
                theme: {
                    type: "string",
                    description: "A troupe pack the play draws on — \"fairy-tale\", \"ocean\", "
                        + "\"villains\", \"forest\". One at a time.",
                },
                minChapters: { type: "number", description: "Default 1. All results still require a script." },
                maxChapters: { type: "number", description: "For finding something short to look at." },
                minSeconds: { type: "number", description: "Runtime in seconds, holds included." },
                maxSeconds: { type: "number", description: "Runtime in seconds. Plays saved before lengths were recorded are skipped when this is set." },
            },
        },
        async execute(args: {
            limit?: number; title?: string; theme?: string;
            minChapters?: number; maxChapters?: number; minSeconds?: number; maxSeconds?: number;
        }) {
            try {
                const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(50, args?.limit || 20))) });
                for (const key of ["title", "theme", "minChapters", "maxChapters", "minSeconds", "maxSeconds"] as const) {
                    const value = args?.[key];
                    if (value !== undefined && value !== null && `${value}`.trim() !== "") query.set(key, String(value));
                }
                const data = await json(await fetch(`/api/plays?${query}`));
                const text = data.plays.length
                    ? data.plays.map((play: any) => {
                        const chapters = `${play.chapters} chapter${play.chapters === 1 ? "" : "s"}`;
                        const length = typeof play.seconds === "number"
                            ? `${Math.floor(play.seconds / 60)}m ${play.seconds % 60}s`
                            : "length unknown";
                        const themes = play.themes?.length ? ` — ${play.themes.join(", ")}` : "";
                        return `${play.id} — ${play.title} — ${chapters}, ${length}${themes} — ${play.url}`;
                    }).join("\n")
                    : "No scripted public play matches that. Try fewer filters.";
                return { content: [{ type: "text", text }], structuredContent: data };
            } catch (error) { return { content: [{ type: "text", text: String(error) }], isError: true }; }
        },
    }, {
        name: "show_load",
        title: "Load a published play",
        annotations: { readOnlyHint: false, destructiveHint: true, consequentialHint: true },
        description: "Download a published or unlisted play by id or share URL and replace the " +
            "current canvas. Existing unsaved work on this canvas may be lost, so use this only " +
            "when replacement was requested. This does not publish either play.",
        inputSchema: { type: "object", properties: { id: { type: "string", description: "Play id or /p/<id> URL." } }, required: ["id"] },
        async execute(args: { id?: string }) {
            try {
                const id = String(args?.id || "").match(/(?:\/p\/)?([A-Za-z0-9_-]{10,40})\/?$/)?.[1];
                if (!id) throw new Error("Pass a play id or share URL.");
                const data = await json(await fetch(`/api/plays/${encodeURIComponent(id)}`));
                const count = await studio.loadPublished!(data.doc as StoredDoc);
                track("play_loaded", { by: "agent", source: "online", pieces: count });
                return { content: [{ type: "text", text: `Loaded “${data.title}” with ${count} layers.` }], structuredContent: { id, title: data.title, layers: count } };
            } catch (error) { return { content: [{ type: "text", text: `Could not load the play: ${error instanceof Error ? error.message : error}` }], isError: true }; }
        },
    }];
}
