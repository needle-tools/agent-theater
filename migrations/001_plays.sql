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
);
create index if not exists plays_public_recent on plays (created_at desc) where visibility = 'public';
