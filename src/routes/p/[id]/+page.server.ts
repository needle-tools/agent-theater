import type { PageServerLoad } from "./$types";
import { database } from "$lib/server/database";
import { describePlay } from "$lib/collage/playSummary";
import { devPlayDoc, devPlays } from "$lib/server/devPlay";
import { dev } from "$app/environment";
import { assetUrl } from "$lib/server/storage";
import { ensurePlayUnfurl, type UnfurlPlay } from "$lib/server/unfurlBackfill";

export const prerender = false;

/**
 * The share page: a play's own link, and the card it unfurls into.
 *
 * This route used to redirect straight to `/?play=…` on the server, which is
 * right for a person and useless for a crawler: the redirect lands it on the
 * prerendered front page, so every play ever shared unfurled as the site
 * rather than as itself. A crawler asks once, reads the <head>, and never runs
 * a line of script — so the title and the description have to be in the HTML
 * this route returns, which means it has to return some.
 *
 * The bounce to the app therefore happens on the client instead. It costs a
 * person nothing they can see and gains the card everything.
 *
 * Legacy direct links get a card too; a pasted link should identify its play.
 */
export const load: PageServerLoad = async ({ params, url }) => {
    const sample = dev ? devPlayDoc(params.id) : null;
    if (sample) {
        const play = devPlays(url.origin).find(item => item.id === params.id)!;
        return { id: params.id, card: {
            title: play.title,
            description: describePlay(play, sample.billing?.byline),
            url: play.url,
        } };
    }
    try {
        const { sql, ready } = database(); await ready;
        const [play] = await sql< (UnfurlPlay & {
            chapters: number | null; duration_seconds: number | null;
            themes: string[]; byline: string | null;
        })[]>`
            select id, title, chapters, duration_seconds, themes, card_sha, card_version,
                   doc, assets, xmin::text as row_version,
                   doc #>> '{billing,byline}' as byline
            from plays where id = ${params.id}`;
        if (play) {
            let image: string | undefined;
            const cardSha = await ensurePlayUnfurl(play);
            if (cardSha) {
                try { image = assetUrl(cardSha); }
                catch { /* The title and fallback house image still make a valid card. */ }
            }
            return {
                id: params.id,
                card: {
                    title: String(play.title || "Untitled play"),
                    // The byline is the author's own sentence about the story;
                    // when it exists, the card leads with it and the pack list
                    // steps aside.
                    description: describePlay({
                        chapters: Number(play.chapters ?? 0),
                        seconds: Number(play.duration_seconds ?? 0),
                        themes: Array.isArray(play.themes) ? play.themes.map(String) : [],
                    }, String(play.byline ?? "")),
                    url: `${url.origin}/p/${encodeURIComponent(params.id)}`,
                    ...(image ? {
                        image,
                        imageAlt: `Paper theater poster for ${String(play.title || "Untitled play")}.`,
                    } : {}),
                },
            };
        }
    } catch (error) {
        // A library that is down must not take the share link with it. Without
        // a card the layout falls back to the site's own, which is a worse
        // preview and a working link — the right way round.
        console.error(error);
    }
    return { id: params.id, card: null };
};
