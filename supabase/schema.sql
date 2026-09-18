-- ECHO memory core schema
create extension if not exists vector with schema extensions;

do $$ begin
  create type memory_status as enum ('ACTIVE','SUPERSEDED','INVALIDATED','EXPIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type memory_type as enum ('decision','fact','preference','constraint','temporary');
exception when duplicate_object then null; end $$;

create table if not exists memories (
  id text primary key,
  user_id text not null,
  project_id text not null,
  type memory_type not null,
  content text not null,
  topic text,
  subject text,
  value text,
  reason text,
  status memory_status not null default 'ACTIVE',
  confidence double precision not null default 0.8,
  importance double precision not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  supersedes_id text references memories(id),
  superseded_by text,
  contradiction_group text,
  change_reason text,
  embedding extensions.vector(1536)
);

alter table memories add column if not exists subject text;

create index if not exists memories_user_project_idx on memories(user_id, project_id, status);
create index if not exists memories_topic_idx on memories(topic);
create index if not exists memories_embedding_hnsw on memories using hnsw (embedding vector_cosine_ops);

create table if not exists memory_events (
  id text primary key,
  memory_id text references memories(id) on delete cascade,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create or replace function match_memories(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int,
  p_user_id text,
  p_project_id text
)
returns table (
  id text,
  user_id text,
  project_id text,
  type memory_type,
  content text,
  topic text,
  subject text,
  value text,
  reason text,
  status memory_status,
  confidence double precision,
  importance double precision,
  created_at timestamptz,
  updated_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  supersedes_id text,
  superseded_by text,
  contradiction_group text,
  change_reason text,
  embedding extensions.vector(1536)
)
language sql stable
as $$
  select m.id,m.user_id,m.project_id,m.type,m.content,m.topic,m.subject,m.value,m.reason,m.status,m.confidence,m.importance,m.created_at,m.updated_at,m.valid_from,m.valid_until,m.supersedes_id,m.superseded_by,m.contradiction_group,m.change_reason,m.embedding
  from memories m
  where m.user_id = p_user_id
    and m.project_id = p_project_id
    and (m.valid_until is null or m.valid_until > now())
    and 1 - (m.embedding <=> query_embedding) >= match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Optional RLS for a future authenticated Supabase session.
-- Keep service-role calls server-side. In production, replace text user_id with auth.uid().
