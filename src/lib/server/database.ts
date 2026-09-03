import postgres from "postgres";
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
                visibility text not null default 'unlisted' check (visibility in ('unlisted', 'public')),
                doc jsonb not null,
                assets jsonb not null default '{}'::jsonb,
                written_by text,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )`;
        await client!`create index if not exists plays_public_recent on plays (created_at desc) where visibility = 'public'`;

        /*
         * The summary an agent filters on, alongside the document it describes.
         *
         * Derived at write time rather than computed per query: `doc` is a
         * whole play, and asking Postgres to walk its jsonb on every listing
         * to count chapters would make the cheap query the expensive one.
         */
        await client!`alter table plays add column if not exists chapters integer`;
        await client!`alter table plays add column if not exists duration_seconds integer`;
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
    })();
    return { sql: client, ready };
}
