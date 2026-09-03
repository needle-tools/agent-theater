import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { database } from "$lib/server/database";
import { owns, resolveAssets, validateAssets, validateDoc } from "$lib/server/plays";

export const prerender = false;

export const GET: RequestHandler = async ({ params }) => {
    try {
        const { sql, ready } = database(); await ready;
        const [play] = await sql`select id, title, visibility, doc, assets, created_at, updated_at from plays where id = ${params.id}`;
        if (!play) return json({ error: "Play not found." }, { status: 404 });
        return json({ ...play, doc: resolveAssets(play.doc, play.assets) });
    } catch (error) { console.error(error); return json({ error: "Play library is unavailable." }, { status: 503 }); }
}

export const PUT: RequestHandler = async ({ params, request, url }) => {
    try {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        const body = await request.json();
        if (!validateDoc(body.doc)) return json({ error: "Invalid play document." }, { status: 400 });
        if (!validateAssets(body.doc, body.assets)) return json({ error: "Invalid or incomplete asset map." }, { status: 400 });
        const { sql, ready } = database(); await ready;
        const [existing] = await sql`select edit_token_hash from plays where id = ${params.id}`;
        if (!existing) return json({ error: "Play not found." }, { status: 404 });
        if (!owns(token, existing.edit_token_hash)) return json({ error: "The edit token is missing or invalid." }, { status: 403 });
        const title = String(body.title || "Untitled play").slice(0, 160);
        const visibility = body.visibility === "public" ? "public" : "unlisted";
        const assets = body.assets;
        await sql`update plays set title=${title}, visibility=${visibility}, doc=${sql.json(body.doc)}, assets=${sql.json(assets)}, updated_at=now() where id=${params.id}`;
        return json({ id: params.id, title, visibility, url: `${url.origin}/p/${params.id}` });
    } catch (error) { console.error(error); return json({ error: "Could not update the play." }, { status: 503 }); }
}
