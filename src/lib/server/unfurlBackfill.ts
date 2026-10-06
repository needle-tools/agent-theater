import type { StoredDoc } from "../collage/persistence.js";
import { unfurlCharacters } from "../collage/shareCard.js";
import { database } from "./database.js";
import { resolveAssets } from "./plays.js";
import { putAsset } from "./storage.js";
import { serverRenderableSource, serverUnfurlWebp } from "./unfurl.js";

// Increment when the poster layout changes. Old cards are replaced once, then
// the final WebP remains in object storage for subsequent crawler requests.
export const UNFURL_STYLE_VERSION = 1;

export interface UnfurlPlay {
    id: string;
    title: string;
    doc: StoredDoc;
    assets: Record<string, string>;
    card_sha: string | null;
    card_version: number;
    updated_at: Date;
}

const pending = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();
const RETRY_MS = 5 * 60_000;

/** Render a legacy card on the server and persist it before answering a crawler. */
export async function ensurePlayUnfurl(play: UnfurlPlay): Promise<string | null> {
    if (play.card_sha && play.card_version >= UNFURL_STYLE_VERSION) return play.card_sha;
    if (Date.now() - (failedAt.get(play.id) ?? 0) < RETRY_MS) return play.card_sha;
    const existing = pending.get(play.id);
    if (existing) return existing;

    const work = (async () => {
        const startedAt = Date.now();
        let phase = "resolve_assets";
        let imageLayers = 0;
        let usableImages = 0;
        let temporarySheets = 0;
        try {
            const doc = resolveAssets(play.doc, play.assets);
            const candidates = unfurlCharacters(doc);
            const characters = candidates.filter(layer => serverRenderableSource(layer.src));
            imageLayers = candidates.length;
            usableImages = characters.length;
            temporarySheets = candidates.filter(layer => /\/api\/sheets\//.test(layer.src)).length;
            if (!characters.length) throw new Error(`No durable character images are available (${candidates.length} image layers checked).`);
            phase = "render";
            const bytes = await serverUnfurlWebp(play.title, characters);
            phase = "upload";
            const sha = await putAsset(bytes);
            phase = "database_update";
            const { sql, ready } = database(); await ready;
            // Compare the source snapshot, not updated_at: PostgreSQL keeps
            // microseconds that are lost when its timestamp becomes a JS Date.
            // An edit made while the poster rendered still wins.
            const [updated] = await sql`
                update plays set card_sha = ${sha}, card_version = ${UNFURL_STYLE_VERSION}
                where id = ${play.id} and title = ${play.title}
                  and doc = ${JSON.stringify(play.doc)}::jsonb
                  and assets = ${JSON.stringify(play.assets)}::jsonb
                  and card_version < ${UNFURL_STYLE_VERSION}
                returning card_sha`;
            if (updated) {
                failedAt.delete(play.id);
                console.info("[unfurl] Card stored.", {
                    id: play.id, cardVersion: UNFURL_STYLE_VERSION,
                    imageLayers, usableImages, bytes: bytes.length,
                    durationMs: Date.now() - startedAt,
                });
                return sha;
            }
            phase = "read_current";
            const [current] = await sql`select card_sha, card_version from plays where id = ${play.id}`;
            console.warn("[unfurl] Rendered card did not match the current play snapshot.", {
                id: play.id, hasCurrentCard: Boolean(current?.card_sha),
                currentVersion: current?.card_version ?? null,
                durationMs: Date.now() - startedAt,
            });
            failedAt.delete(play.id);
            return current?.card_sha ?? null;
        } catch (error) {
            failedAt.set(play.id, Date.now());
            console.error("[unfurl] Server card generation failed.", {
                id: play.id, phase, imageLayers, usableImages, temporarySheets,
                unsupportedImages: imageLayers - usableImages - temporarySheets,
                hasExistingCard: Boolean(play.card_sha),
                durationMs: Date.now() - startedAt, error,
            });
            return play.card_sha;
        } finally {
            pending.delete(play.id);
        }
    })();
    pending.set(play.id, work);
    return work;
}

let backfillRunning = false;

/** Fill all existing cards in small, sequential batches after server startup. */
export async function backfillPlayUnfurls(): Promise<void> {
    if (backfillRunning) return;
    backfillRunning = true;
    let cursor = "";
    let attempted = 0;
    let stored = 0;
    let failed = 0;
    try {
        const { sql, ready } = database(); await ready;
        while (true) {
            const rows = await sql<UnfurlPlay[]>`
                select id, title, doc, assets, card_sha, card_version, updated_at
                from plays where id > ${cursor} and card_version < ${UNFURL_STYLE_VERSION}
                order by id limit 20`;
            if (!rows.length) break;
            for (const play of rows) {
                attempted++;
                const sha = await ensurePlayUnfurl(play);
                if (sha && !failedAt.has(play.id)) stored++;
                else failed++;
            }
            cursor = rows[rows.length - 1].id;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        console.info("[unfurl] Server backfill finished.", { attempted, stored, failed });
    } catch (error) {
        console.error("[unfurl] Server backfill stopped.", error);
    } finally {
        backfillRunning = false;
    }
}
