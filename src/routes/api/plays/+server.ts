import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { database } from "$lib/server/database";
import { newId, newToken, tokenHash, validateDoc } from "$lib/server/plays";
import { env } from "$env/dynamic/private";

export const prerender = false;

export async function GET({ url }: { url: URL }) {
    try {
        const { sql, ready } = database(); await ready;
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20));
        const rows = await sql`select id, title, created_at, updated_at from plays where visibility = 'public' order by created_at desc limit ${limit}`;
        return json({ plays: rows.map(row => ({ ...row, url: `${url.origin}/p/${row.id}` })) });
    } catch (error) { console.error(error); return json({ error: "Play library is unavailable." }, { status: 503 }); }
}

export const POST: RequestHandler = async ({ request, url }) => {
    try {
        const body = await request.json();
        if (!validateDoc(body.doc)) return json({ error: "Invalid play document." }, { status: 400 });
        const assets = body.assets && typeof body.assets === "object" ? body.assets : {};
        const id = newId(); const editToken = newToken();
        const title = String(body.title || "Untitled play").slice(0, 160);
        const visibility = body.visibility === "public" ? "public" : "unlisted";
        const { sql, ready } = database(); await ready;
        await sql`insert into plays (id, edit_token_hash, title, visibility, doc, assets, written_by)
            values (${id}, ${tokenHash(editToken)}, ${title}, ${visibility}, ${sql.json(body.doc)}, ${sql.json(assets)}, ${env.COMMIT_SHA || null})`;
        return json({ id, editToken, title, visibility, url: `${url.origin}/p/${id}` }, { status: 201 });
    } catch (error) { console.error(error); return json({ error: "Could not save the play." }, { status: 503 }); }
}
