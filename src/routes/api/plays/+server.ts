import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { claimPublishSlot, database } from "$lib/server/database";
import { publishLimitMessage } from "$lib/server/publishLimit";
import { notifyNewPlayPublished } from "$lib/server/discordPlayWebhook";
import { newId, newToken, tokenHash, validateAssets, validateDoc } from "$lib/server/plays";
import { summarize } from "$lib/collage/playSummary";
import { env } from "$env/dynamic/private";
import { dev } from "$app/environment";
import { devPlays } from "$lib/server/devPlay";
import { UNFURL_STYLE_VERSION } from "$lib/server/unfurlBackfill";
import { playLanguage } from "$lib/collage/language";

export const prerender = false;

/**
 * The public shelf, and what an agent can ask of it.
 *
 * Public discovery requires a scripted beat. Saved arrangements and tableaux
 * still have direct links, but are not suggested as community plays.
 *
 * Length filters skip rows written before durations were recorded, because
 * "unknown" is not "short" and answering a request for plays under a minute
 * with something that might run five is worse than answering with less.
 */
export async function GET({ url }: { url: URL }) {
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
    const language = q.has("language") ? playLanguage(q.get("language")) : "";
    const sampleFits = !title && !theme && minChapters <= 1
        && !language && maxChapters === null && minSeconds === null && maxSeconds === null;

    if (!env.DATABASE_URL) {
        console.warn("[plays] DATABASE_URL is not configured.");
        if (dev) return json({ plays: sampleFits ? devPlays(url.origin).slice(0, limit) : [], unavailable: true });
        return json({ error: "Play library is unavailable." }, { status: 503 });
    }
    try {
        const { sql, ready } = database(); await ready;

        const rows = await sql`
            select id, title, chapters, duration_seconds, themes, language, created_at, updated_at
            from plays
            where visibility = 'public'
              and scripted = true
              and coalesce(chapters, 0) >= ${minChapters}
              ${maxChapters === null ? sql`` : sql`and coalesce(chapters, 0) <= ${Math.trunc(maxChapters)}`}
              ${minSeconds === null ? sql`` : sql`and duration_seconds >= ${Math.trunc(minSeconds)}`}
              ${maxSeconds === null ? sql`` : sql`and duration_seconds <= ${Math.trunc(maxSeconds)}`}
              ${title ? sql`and title ilike ${"%" + title.replace(/[%_\\]/g, "\\$&") + "%"}` : sql``}
              ${theme ? sql`and ${theme} = any(themes)` : sql``}
              ${language ? sql`and language = ${language}` : sql``}
            order by created_at desc limit ${limit}`;

        if (!rows.length) {
            const counts = sampleFits
                ? await sql`select visibility, count(*)::int as count from plays group by visibility`
                : [];
            console.info("[plays] No public plays matched the list request.", {
                minChapters, filtered: !sampleFits, counts,
            });
        }

        return json({
            plays: (rows.length ? rows : dev && sampleFits ? devPlays(url.origin).slice(0, limit) : []).map(row => ({
                id: row.id,
                title: row.title,
                chapters: row.chapters ?? 0,
                seconds: "duration_seconds" in row ? row.duration_seconds : row.seconds,
                themes: row.themes ?? [],
                language: row.language ?? "und",
                created_at: row.created_at,
                updated_at: row.updated_at,
                url: `${url.origin}/p/${row.id}`,
            })),
        });
    } catch (error) {
        console.error("[plays] Public play listing failed.", error);
        return json({ error: "Play library is unavailable." }, { status: 503 });
    }
}

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
    try {
        const body = await request.json();
        if (!validateDoc(body.doc)) return json({ error: "Invalid play document." }, { status: 400 });
        if (!validateAssets(body.doc, body.assets)) return json({ error: "Invalid or incomplete asset map." }, { status: 400 });
        const assets = body.assets;
        const id = newId(); const editToken = newToken();
        const title = String(body.title || "Untitled play").slice(0, 160);
        const language = playLanguage(body.language ?? body.doc.billing?.language);
        const doc = { ...body.doc, billing: { ...body.doc.billing, language } };
        const cardSha = typeof body.cardSha === "string" && /^[a-f0-9]{64}$/.test(body.cardSha) ? body.cardSha : null;
        const visibility = "public";
        const limit = await claimPublishSlot(getClientAddress());
        if (!limit.allowed) return json({
            error: publishLimitMessage(limit.retryAfter),
            retryAfter: limit.retryAfter,
        }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
        const summary = summarize(doc);
        const { sql, ready } = database(); await ready;
        await sql`insert into plays (id, edit_token_hash, title, visibility, doc, assets, card_sha, card_version, language, written_by, chapters, duration_seconds, themes, scripted)
            values (${id}, ${tokenHash(editToken)}, ${title}, ${visibility}, ${sql.json(doc)}, ${sql.json(assets)}, ${cardSha}, ${cardSha ? UNFURL_STYLE_VERSION : 0}, ${language}, ${env.COMMIT_SHA || null},
                    ${summary.chapters}, ${summary.seconds}, ${summary.themes}::text[], ${summary.scripted})`;
        await notifyNewPlayPublished({ id, title, url: `${url.origin}/p/${id}`, chapters: summary.chapters, language }, env.DISCORD_PLAY_WEBHOOK_URL);
        return json({ id, editToken, title, visibility, language, ...summary, url: `${url.origin}/p/${id}` }, { status: 201 });
    } catch (error) { console.error(error); return json({ error: "Could not save the play." }, { status: 503 }); }
}
