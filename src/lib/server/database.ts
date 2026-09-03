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
    })();
    return { sql: client, ready };
}
