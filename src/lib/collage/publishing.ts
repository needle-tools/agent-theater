import type { CollageStudio } from "./studio.js";
import type { StoredDoc } from "./persistence.js";
import type { WebMcpToolDef } from "./tools.js";

export const TOKEN_PREFIX = "needle-play/edit/";

export interface PublishedPlay {
    id: string;
    title: string;
    visibility: "public" | "unlisted";
    url: string;
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
    if (!response.ok) throw new Error(body.error || `Server returned ${response.status}.`);
    return body;
}

export function playId(value: string): string | null {
    return value.trim().match(/(?:\/p\/)?([A-Za-z0-9_-]{10,40})\/?(?:[?#].*)?$/)?.[1] ?? null;
}

export function canEditPlay(id: string): boolean {
    try { return !!localStorage.getItem(TOKEN_PREFIX + id); } catch { return false; }
}

export async function savePlayOnline(
    studio: CollageStudio,
    options: { published: boolean; id?: string; title?: string },
): Promise<PublishedPlay> {
    const assets: Record<string, string> = {};
    const local = await studio.storedAssets!();
    if (local.length > 40) throw new Error("A play can publish at most 40 custom images.");
    let total = 0;
    for (const asset of local) {
        const encoded = await webp(asset.blob);
        total += encoded.size;
        if (total > 12_582_912) throw new Error("Custom images exceed the 12 MB per-play limit.");
        const uploaded = await json(await fetch("/api/assets", {
            method: "POST", headers: { "content-type": "image/webp" }, body: encoded,
        }));
        assets[asset.key] = uploaded.sha;
    }
    const id = options.id;
    const token = id ? localStorage.getItem(TOKEN_PREFIX + id) : null;
    const result = await json(await fetch(id ? `/api/plays/${encodeURIComponent(id)}` : "/api/plays", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
            title: options.title || studio.collage.billing.title || "Untitled play",
            visibility: options.published ? "public" : "unlisted",
            doc: studio.storedDoc!(), assets,
        }),
    })) as PublishedPlay & { editToken?: string };
    if (result.editToken) localStorage.setItem(TOKEN_PREFIX + result.id, result.editToken);
    return result;
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
    return { play: { ...play, id, url: `${location.origin}/p/${id}` }, layers };
}

export function publishingTools(studio: CollageStudio): WebMcpToolDef[] {
    const save = (published: boolean): WebMcpToolDef => ({
        name: published ? "show_publish" : "show_save",
        title: published ? "Publish this play" : "Save this play online",
        description: published
            ? "Publish the current play to the shared library and return a shareable URL."
            : "Save the current play online as an unlisted shareable link. Reuses its edit token when id is supplied.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Existing play id to update. Omit to create one." },
                title: { type: "string", description: "Library title. Defaults to the play's title card." },
            },
        },
        async execute(args: { id?: string; title?: string }) {
            try {
                const assets: Record<string, string> = {};
                const local = await studio.storedAssets!();
                if (local.length > 40) throw new Error("A play can publish at most 40 custom images.");
                let total = 0;
                for (const asset of local) {
                    const encoded = await webp(asset.blob);
                    total += encoded.size;
                    if (total > 12_582_912) throw new Error("Custom images exceed the 12 MB per-play limit.");
                    const uploaded = await json(await fetch("/api/assets", {
                        method: "POST", headers: { "content-type": "image/webp" }, body: encoded,
                    }));
                    assets[asset.key] = uploaded.sha;
                }
                const id = typeof args?.id === "string" ? args.id : undefined;
                const token = id ? localStorage.getItem(TOKEN_PREFIX + id) : null;
                const result = await json(await fetch(id ? `/api/plays/${encodeURIComponent(id)}` : "/api/plays", {
                    method: id ? "PUT" : "POST",
                    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({
                        title: args?.title || studio.collage.billing.title || "Untitled play",
                        visibility: published ? "public" : "unlisted",
                        doc: studio.storedDoc!(), assets,
                    }),
                }));
                if (result.editToken) localStorage.setItem(TOKEN_PREFIX + result.id, result.editToken);
                return { content: [{ type: "text", text: `${published ? "Published" : "Saved"} “${result.title}”. Share: ${result.url}` }], structuredContent: result };
            } catch (error) {
                return { content: [{ type: "text", text: `Could not save the play: ${error instanceof Error ? error.message : error}` }], isError: true };
            }
        },
    });

    return [save(false), save(true), {
        name: "show_list",
        title: "List published plays",
        description: "Find public plays made here — id, title, how many chapters, how long, "
            + "which troupe packs, and the shareable URL. Only plays with at least one chapter "
            + "are listed: a canvas somebody saved without scripting it is not something to load. "
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
                minChapters: { type: "number", description: "Default 1. Pass 0 to include unscripted canvases." },
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
                    : "No published play matches that. Try fewer filters, or minChapters: 0 to include unscripted canvases.";
                return { content: [{ type: "text", text }], structuredContent: data };
            } catch (error) { return { content: [{ type: "text", text: String(error) }], isError: true }; }
        },
    }, {
        name: "show_load",
        title: "Load a published play",
        description: "Replace the current canvas with a published or unlisted play by id or share URL.",
        inputSchema: { type: "object", properties: { id: { type: "string", description: "Play id or /p/<id> URL." } }, required: ["id"] },
        async execute(args: { id?: string }) {
            try {
                const id = String(args?.id || "").match(/(?:\/p\/)?([A-Za-z0-9_-]{10,40})\/?$/)?.[1];
                if (!id) throw new Error("Pass a play id or share URL.");
                const data = await json(await fetch(`/api/plays/${encodeURIComponent(id)}`));
                const count = await studio.loadPublished!(data.doc as StoredDoc);
                return { content: [{ type: "text", text: `Loaded “${data.title}” with ${count} layers.` }], structuredContent: { id, title: data.title, layers: count } };
            } catch (error) { return { content: [{ type: "text", text: `Could not load the play: ${error instanceof Error ? error.message : error}` }], isError: true }; }
        },
    }];
}
