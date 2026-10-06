import type { PageServerLoad } from "./$types";
import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import { languageName, playLanguage } from "$lib/collage/language";
import { database } from "$lib/server/database";
import { devPlays } from "$lib/server/devPlay";
import { assetUrl } from "$lib/server/storage";

export const prerender = false;
const PAGE_SIZE = 24;

type Row = {
    id: string; title: string; language: string; chapters: number | null;
    duration_seconds: number | null; card_sha: string | null;
    byline: string | null; created_at: Date;
};

export const load: PageServerLoad = async ({ url }) => {
    const rawPage = Number(url.searchParams.get("page"));
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
    const requestedLanguage = url.searchParams.get("language");
    const language = requestedLanguage ? playLanguage(requestedLanguage) : "";
    const heading = language ? `${languageName(language)} community plays` : "Community plays";
    const canonical = `${url.origin}/plays${language ? `?language=${encodeURIComponent(language)}` : ""}`;
    const card = {
        title: `${heading}${page > 1 ? ` · Page ${page}` : ""} · Agent Theater`,
        description: "Watch paper theatre stories made with Agent Theater. Browse the published plays and open any stage.",
        url: `${canonical}${page > 1 ? `${language ? "&" : "?"}page=${page}` : ""}`,
    };

    if (!env.DATABASE_URL) {
        const samples = dev ? devPlays(url.origin).filter(play => !language || play.language === language) : [];
        return { plays: samples.map(play => ({
            ...play, image: `${url.origin}/og.webp`, byline: "", chapters: play.chapters,
            seconds: play.seconds,
        })), total: samples.length, page: 1, pages: 1, language,
        languages: samples.length ? ["en"] : [], unavailable: !dev, card, canonical };
    }

    try {
        const { sql, ready } = database(); await ready;
        const [countRows, languageRows, rows] = await Promise.all([
            sql<{ count: number }[]>`select count(*)::int as count from plays
                where visibility = 'public' and scripted = true
                  ${language ? sql`and language = ${language}` : sql``}`,
            sql<{ language: string }[]>`select distinct language from plays
                where visibility = 'public' and scripted = true order by language`,
            sql<Row[]>`select id, title, language, chapters, duration_seconds, card_sha,
                    doc #>> '{billing,byline}' as byline, created_at
                from plays where visibility = 'public' and scripted = true
                  ${language ? sql`and language = ${language}` : sql``}
                order by created_at desc, id desc
                limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
        ]);
        const total = countRows[0]?.count ?? 0;
        const plays = rows.map(row => {
            let image = `${url.origin}/og.webp`;
            if (row.card_sha) {
                try { image = assetUrl(row.card_sha); } catch { /* Use the house image. */ }
            }
            return {
                id: row.id, title: row.title, language: row.language,
                byline: row.byline ?? "", chapters: row.chapters ?? 0,
                seconds: row.duration_seconds, image,
                created_at: row.created_at.toISOString(),
                url: `${url.origin}/p/${encodeURIComponent(row.id)}`,
            };
        });
        return { plays, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            language, languages: languageRows.map(row => row.language),
            unavailable: false, card, canonical };
    } catch (error) {
        console.error("[plays] Public play page failed.", error);
        return { plays: [], total: 0, page: 1, pages: 1, language,
            languages: [], unavailable: true, card, canonical };
    }
};
