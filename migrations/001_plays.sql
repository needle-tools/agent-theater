create table if not exists plays (
    id text primary key,
    edit_token_hash text not null,
    title text not null,
    visibility text not null default 'public' check (visibility in ('unlisted', 'public')),
    doc jsonb not null,
    assets jsonb not null default '{}'::jsonb,
    card_sha text,
    card_version integer not null default 0,
    written_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists plays_public_recent on plays (created_at desc) where visibility = 'public';

create table if not exists play_publish_events (
    client_key text not null,
    published_at timestamptz not null default now()
);
create index if not exists play_publish_events_client_time
    on play_publish_events (client_key, published_at desc);
