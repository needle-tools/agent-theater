import type { PageServerLoad } from "./$types";
import { database } from "$lib/server/database";
import { describePlay } from "$lib/collage/playSummary";

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
 * Unlisted plays get a card too. Unlisted means "whoever has the link", and a
 * link is exactly what is being pasted; a preview that refused to say what it
 * was would be protecting nobody from anything.
 */
export const load: PageServerLoad = async ({ params, url }) => {
    try {
        const { sql, ready } = database(); await ready;
        const [play] = await sql`
            select title, chapters, duration_seconds, themes
            from plays where id = ${params.id}`;
        if (play) {
            return {
                id: params.id,
                card: {
                    title: String(play.title || "Untitled play"),
                    description: describePlay({
                        chapters: Number(play.chapters ?? 0),
                        seconds: Number(play.duration_seconds ?? 0),
                        themes: Array.isArray(play.themes) ? play.themes.map(String) : [],
                    }),
                    url: `${url.origin}/p/${encodeURIComponent(params.id)}`,
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
