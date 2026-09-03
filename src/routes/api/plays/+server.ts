import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { database } from "$lib/server/database";
import { newId, newToken, tokenHash, validateAssets, validateDoc } from "$lib/server/plays";
import { summarize } from "$lib/collage/playSummary";
import { env } from "$env/dynamic/private";

export const prerender = false;

/**
 * The public shelf, and what an agent can ask of it.
 *
 * The default is the important part: `minChapters` is 1, so a canvas somebody
 * saved without ever scripting it is not offered as something to load. Asking
 * for 0 brings them back for a caller that genuinely wants everything.
 *
 * Length filters skip rows written before durations were recorded, because
 * "unknown" is not "short" and answering a request for plays under a minute
 * with something that might run five is worse than answering with less.
 */
export async function GET({ url }: { url: URL }) {
    try {
        const { sql, ready } = database(); await ready;
        const q = url.searchParams;
        const number = (name: string) => {
            const raw = q.get(name);
            if (raw === null || raw.trim() === "") return null;
            const value = Number(raw);
            return Number.isFinite(value) ? value : null;
        };
        const limit = Math.max(1, Math.min(50, Number(q.get("limit")) || 20));
        const minChapters = Math.max(0, Math.trunc(number("minChapters") ?? 1));
        const maxChapters = number("maxChapters");
        const minSeconds = number("minSeconds");
        const maxSeconds = number("maxSeconds");
        const title = (q.get("title") ?? "").trim().slice(0, 120);
        const theme = (q.get("theme") ?? "").trim().toLowerCase().slice(0, 40);

        const rows = await sql`
            select id, title, chapters, duration_seconds, themes, created_at, updated_at
            from plays
            where visibility = 'public'
              and coalesce(chapters, 0) >= ${minChapters}
              ${maxChapters === null ? sql`` : sql`and coalesce(chapters, 0) <= ${Math.trunc(maxChapters)}`}
              ${minSeconds === null ? sql`` : sql`and duration_seconds >= ${Math.trunc(minSeconds)}`}
              ${maxSeconds === null ? sql`` : sql`and duration_seconds <= ${Math.trunc(maxSeconds)}`}
              ${title ? sql`and title ilike ${"%" + title.replace(/[%_\\]/g, "\\$&") + "%"}` : sql``}
              ${theme ? sql`and ${theme} = any(themes)` : sql``}
            order by created_at desc limit ${limit}`;

        return json({
            plays: rows.map(row => ({
                id: row.id,
                title: row.title,
                chapters: row.chapters ?? 0,
                seconds: row.duration_seconds,
                themes: row.themes ?? [],
                created_at: row.created_at,
                updated_at: row.updated_at,
                url: `${url.origin}/p/${row.id}`,
            })),
        });
    } catch (error) { console.error(error); return json({ error: "Play library is unavailable." }, { status: 503 }); }
}

export const POST: RequestHandler = async ({ request, url }) => {
    try {
        const body = await request.json();
        if (!validateDoc(body.doc)) return json({ error: "Invalid play document." }, { status: 400 });
        if (!validateAssets(body.doc, body.assets)) return json({ error: "Invalid or incomplete asset map." }, { status: 400 });
        const assets = body.assets;
        const id = newId(); const editToken = newToken();
        const title = String(body.title || "Untitled play").slice(0, 160);
        const visibility = body.visibility === "public" ? "public" : "unlisted";
        const summary = summarize(body.doc);
        const { sql, ready } = database(); await ready;
        await sql`insert into plays (id, edit_token_hash, title, visibility, doc, assets, written_by, chapters, duration_seconds, themes)
            values (${id}, ${tokenHash(editToken)}, ${title}, ${visibility}, ${sql.json(body.doc)}, ${sql.json(assets)}, ${env.COMMIT_SHA || null},
                    ${summary.chapters}, ${summary.seconds}, ${summary.themes}::text[])`;
        return json({ id, editToken, title, visibility, ...summary, url: `${url.origin}/p/${id}` }, { status: 201 });
    } catch (error) { console.error(error); return json({ error: "Could not save the play." }, { status: 503 }); }
}
