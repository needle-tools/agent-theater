import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { database } from "$lib/server/database";

export const prerender = false;

export const GET: RequestHandler = async ({ url }) => {
    const root = url.origin;
    const entries = [`<url><loc>${root}/</loc></url>`, `<url><loc>${root}/plays</loc></url>`];
    if (env.DATABASE_URL) {
        try {
            const { sql, ready } = database(); await ready;
            const rows = await sql<{ id: string; updated_at: Date }[]>`
                select id, updated_at from plays
                where visibility = 'public' and scripted = true
                order by created_at desc`;
            for (const play of rows) {
                entries.push(`<url><loc>${root}/p/${encodeURIComponent(play.id)}</loc>` +
                    `<lastmod>${play.updated_at.toISOString()}</lastmod></url>`);
            }
        } catch (error) {
            console.error("[plays] Sitemap generation failed.", error);
            return new Response("Sitemap is temporarily unavailable.", {
                status: 503, headers: { "cache-control": "no-store" },
            });
        }
    }
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`, {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
};
