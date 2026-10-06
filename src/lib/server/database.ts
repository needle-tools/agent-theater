import postgres from "postgres";
import { createHash } from "node:crypto";
import { env } from "$env/dynamic/private";

let client: ReturnType<typeof postgres> | null = null;
let ready: Promise<void> | null = null;

export function database() {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    client ??= postgres(env.DATABASE_URL, { max: 10, idle_timeout: 20 });
    ready ??= (async () => {
        await client!`
            create table if not exists plays (
                id text primary key,
                edit_token_hash text not null,
                title text not null,
                visibility text not null default 'public' check (visibility in ('unlisted', 'public')),
                doc jsonb not null,
                assets jsonb not null default '{}'::jsonb,
                written_by text,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )`;
        await client!`alter table plays alter column visibility set default 'public'`;
        await client!`create index if not exists plays_public_recent on plays (created_at desc) where visibility = 'public'`;

        /*
         * The summary an agent filters on, alongside the document it describes.
         *
         * Derived at write time rather than computed per query: `doc` is a
         * whole play, and asking Postgres to walk its jsonb on every listing
         * to count chapters would make the cheap query the expensive one.
         */
        await client!`alter table plays add column if not exists chapters integer`;
        await client!`alter table plays add column if not exists scripted boolean`;
        await client!`alter table plays add column if not exists duration_seconds integer`;
        await client!`alter table plays add column if not exists card_sha text`;
        await client!`alter table plays add column if not exists card_version integer not null default 0`;
        await client!`alter table plays add column if not exists themes text[] not null default '{}'`;

        /*
         * Rows written before the summary existed. Chapters and themes are
         * both answerable in SQL, so they are filled in here and the listing
         * can trust them for every row.
         *
         * Duration is not: it comes from the beat planner, which is TypeScript
         * and knows how long a `walk` takes. Legacy rows keep NULL, which the
         * listing reads as "unknown" — they appear normally, and drop out only
         * when somebody actually filters on length.
         */
        await client!`
            update plays set
                chapters = coalesce((
                    select count(*) from jsonb_array_elements(
                        case when jsonb_typeof(doc->'stages') = 'array'
                             then doc->'stages' else '[]'::jsonb end) as stage
                    where jsonb_array_length(
                              case when jsonb_typeof(stage->'cast') = 'array'
                                   then stage->'cast' else '[]'::jsonb end) > 0
                       or jsonb_array_length(
                              case when jsonb_typeof(stage->'script') = 'array'
                                   then stage->'script' else '[]'::jsonb end) > 0), 0),
                themes = coalesce((
                    select array_agg(distinct pack order by pack)
                    from jsonb_array_elements(
                        case when jsonb_typeof(doc->'layers') = 'array'
                             then doc->'layers' else '[]'::jsonb end) as layer,
                        lateral (select (regexp_match(layer->>'src', '^/troupe/([a-z0-9-]+)/'))[1] as pack) p
                    where pack is not null), '{}')
            where chapters is null`;

        await client!`create index if not exists plays_public_playable
            on plays (chapters, created_at desc) where visibility = 'public'`;

        // Existing public rows can include tableaux with cast but no story.
        await client!`update plays set scripted = exists (
            select 1 from jsonb_array_elements(
                case when jsonb_typeof(doc->'stages') = 'array'
                     then doc->'stages' else '[]'::jsonb end) as stage
            where jsonb_array_length(
                case when jsonb_typeof(stage->'script') = 'array'
                     then stage->'script' else '[]'::jsonb end) > 0
        ) where scripted is null`;
        await client!`create index if not exists plays_public_scripted_recent
            on plays (created_at desc) where visibility = 'public' and scripted = true`;

        await client!`
            create table if not exists play_publish_events (
                client_key text not null,
                published_at timestamptz not null default now()
            )`;
        await client!`create index if not exists play_publish_events_client_time
            on play_publish_events (client_key, published_at desc)`;

        // One-time release of the nine unlisted plays reported on 2026-10-05.
        // Run only during October 5–6 in Berlin. The creation cutoff excludes
        // anything saved after that report, and the ledger stops later restarts
        // from repeating the release on later restarts.
        const now = Date.now();
        if (now >= Date.parse("2026-10-04T22:00:00Z")
            && now < Date.parse("2026-10-06T22:00:00Z")) {
            const migration = "publish-nine-existing-plays-2026-10-05";
            const cutoff = "2026-10-05T09:56:13Z";
            await client!`create table if not exists play_data_migrations (
                name text primary key,
                applied_at timestamptz not null default now()
            )`;
            await client!.begin(async tx => {
                const claimed = await tx`insert into play_data_migrations (name)
                    values (${migration}) on conflict do nothing returning name`;
                if (!claimed.length) return;
                const candidates = await tx`select id from plays
                    where visibility = 'unlisted' and created_at <= ${cutoff}::timestamptz
                    for update`;
                if (candidates.length !== 9) {
                    await tx`delete from play_data_migrations where name = ${migration}`;
                    console.warn("[plays] One-time publish skipped: expected nine pre-existing unlisted plays.", {
                        found: candidates.length,
                    });
                    return;
                }
                const updated = await tx`update plays set visibility = 'public', updated_at = now()
                    where visibility = 'unlisted' and created_at <= ${cutoff}::timestamptz
                    returning id`;
                console.info("[plays] One-time publish completed.", { count: updated.length });
            });
        }
    })();
    return { sql: client, ready };
}

/**
 * Atomically reserve one public-publish slot for a client address.
 * Only a SHA-256 digest reaches Postgres; raw addresses are never retained.
 */
export async function claimPublishSlot(address: string): Promise<{ allowed: boolean; retryAfter: number }> {
    const { sql, ready } = database();
    await ready;
    const key = createHash("sha256").update(address || "unknown").digest("hex");

    return sql.begin(async transaction => {
        // Serialize simultaneous publishes from the same client so parallel
        // requests cannot all observe a free final slot.
        await transaction`select pg_advisory_xact_lock(hashtext(${key}))`;
        await transaction`delete from play_publish_events
            where client_key = ${key} and published_at <= now() - interval '30 minutes'`;
        const events = await transaction<{ age_seconds: number }[]>`
            select extract(epoch from (now() - published_at))::float8 as age_seconds
            from play_publish_events
            where client_key = ${key} and published_at > now() - interval '30 minutes'
            order by published_at asc`;

        const minute = events.filter(event => event.age_seconds < 60);
        const minuteRetry = minute.length >= 5
            ? Math.max(1, Math.ceil(60 - Math.max(...minute.map(event => event.age_seconds))))
            : 0;
        const halfHourRetry = events.length >= 20
            ? Math.max(1, Math.ceil(1800 - Math.max(...events.map(event => event.age_seconds))))
            : 0;
        const retryAfter = Math.max(minuteRetry, halfHourRetry);
        if (retryAfter) return { allowed: false, retryAfter };

        await transaction`insert into play_publish_events (client_key) values (${key})`;
        return { allowed: true, retryAfter: 0 };
    });
}
