import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { claimPublishSlot, database } from "$lib/server/database";
import { owns, resolveAssets, validateAssets, validateDoc } from "$lib/server/plays";
import { summarize } from "$lib/collage/playSummary";
import { devPlayDoc, devPlays } from "$lib/server/devPlay";
import { dev } from "$app/environment";

export const prerender = false;

export const GET: RequestHandler = async ({ params, url }) => {
    const sample = dev ? devPlayDoc(params.id) : null;
    if (sample)
        return json({ ...devPlays(url.origin).find(play => play.id === params.id), doc: sample });
    try {
        const { sql, ready } = database(); await ready;
        const [play] = await sql`select id, title, visibility, doc, assets, chapters, duration_seconds, themes, created_at, updated_at from plays where id = ${params.id}`;
        if (!play) return json({ error: "Play not found." }, { status: 404 });
        return json({ ...play, doc: resolveAssets(play.doc, play.assets) });
    } catch (error) { console.error(error); return json({ error: "Play library is unavailable." }, { status: 503 }); }
}

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
    try {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        const body = await request.json();
        if (!validateDoc(body.doc)) return json({ error: "Invalid play document." }, { status: 400 });
        if (!validateAssets(body.doc, body.assets)) return json({ error: "Invalid or incomplete asset map." }, { status: 400 });
        const { sql, ready } = database(); await ready;
        const [existing] = await sql`select edit_token_hash, visibility from plays where id = ${params.id}`;
        if (!existing) return json({ error: "Play not found." }, { status: 404 });
        if (!owns(token, existing.edit_token_hash)) return json({ error: "The edit token is missing or invalid." }, { status: 403 });
        const title = String(body.title || "Untitled play").slice(0, 160);
        const visibility = "public";
        if (existing.visibility !== "public") {
            const limit = await claimPublishSlot(getClientAddress());
            if (!limit.allowed) return json({
                error: `Publishing is limited to 5 times per minute and 20 times per 30 minutes. Try again in ${limit.retryAfter} seconds.`,
                retryAfter: limit.retryAfter,
            }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
        }
        const assets = body.assets;
        // Recomputed, not carried over: an edit that adds a chapter or cuts one
        // has to be findable as what it now is, not as what it was published as.
        const summary = summarize(body.doc);
        await sql`update plays set title=${title}, visibility=${visibility}, doc=${sql.json(body.doc)}, assets=${sql.json(assets)},
            chapters=${summary.chapters}, duration_seconds=${summary.seconds}, themes=${summary.themes}::text[],
            scripted=${summary.scripted}, updated_at=now() where id=${params.id}`;
        return json({ id: params.id, title, visibility, ...summary, url: `${url.origin}/p/${params.id}` });
    } catch (error) { console.error(error); return json({ error: "Could not update the play." }, { status: 503 }); }
}
