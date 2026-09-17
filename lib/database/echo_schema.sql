-- ============================================================================
-- ECHO — Database + RAG Layer
-- Supabase / PostgreSQL / pgvector
--
-- Scope: schema, indexes, similarity search, lifecycle management,
-- RLS, sample data, example backend query.
-- Explicitly OUT of scope: frontend, main chat/completion API.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================

create extension if not exists vector;      -- pgvector
create extension if not exists pgcrypto;    -- gen_random_uuid()


-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

create type memory_status as enum (
  'ACTIVE',
  'SUPERSEDED',
  'STALE',
  'ARCHIVED'
);

create type memory_type as enum (
  'fact',
  'preference',
  'event',
  'summary',
  'instruction'
);

create type memory_event_type as enum (
  'CREATED',
  'UPDATED',
  'SUPERSEDED',
  'ARCHIVED',
  'STALE',
  'ACCESSED'
);

-- Embedding dimension is fixed per-column in pgvector. 1536 matches
-- OpenAI text-embedding-3-small/ada-002. Change to 1024/768/etc. if your
-- embedding model differs — do this before you load real data, since
-- pgvector does not support altering the dimension in place cheaply.


-- ============================================================================
-- 2. TABLES
-- ============================================================================

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists memories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,

  content         text not null,
  embedding       vector(1536) not null,

  memory_type     memory_type not null default 'fact',
  importance      smallint not null default 3 check (importance between 1 and 5),
  confidence      numeric(3,2) not null default 1.00 check (confidence between 0 and 1),

  status          memory_status not null default 'ACTIVE',
  reason          text,                       -- why this memory exists / was changed

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_accessed   timestamptz,
  expires_at      timestamptz,                -- null = never expires

  supersedes_id   uuid references memories(id) on delete set null
);

create table if not exists memory_events (
  id          uuid primary key default gen_random_uuid(),
  memory_id   uuid not null references memories(id) on delete cascade,
  event_type  memory_event_type not null,
  reason      text,
  created_at  timestamptz not null default now()
);


-- ============================================================================
-- 3. INDEXES
-- ============================================================================

-- Vector similarity index (cosine distance — matches normalized embeddings
-- from OpenAI/most embedding APIs). ivfflat needs ANALYZE after bulk loads,
-- and "lists" tuned to roughly sqrt(row_count) once you have real volume.
-- Swap to HNSW (below) if your pgvector version supports it and you want
-- better recall without retraining lists.
create index if not exists memories_embedding_ivfflat_idx
  on memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Alternative (pgvector >= 0.5.0), generally preferred for RAG workloads:
-- create index if not exists memories_embedding_hnsw_idx
--   on memories using hnsw (embedding vector_cosine_ops)
--   with (m = 16, ef_construction = 64);

-- Every retrieval query filters by user_id + status first — this is the
-- index that actually enforces isolation performance, not just the vector one.
create index if not exists memories_user_status_idx
  on memories (user_id, status);

create index if not exists memories_expires_at_idx
  on memories (expires_at)
  where expires_at is not null;

create index if not exists memories_supersedes_idx
  on memories (supersedes_id)
  where supersedes_id is not null;

create index if not exists memory_events_memory_id_idx
  on memory_events (memory_id);

create index if not exists memory_events_type_idx
  on memory_events (event_type);


-- ============================================================================
-- 4. updated_at TRIGGER
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_memories_updated_at on memories;
create trigger trg_memories_updated_at
  before update on memories
  for each row
  execute function set_updated_at();


-- ============================================================================
-- 5. EVENT LOGGING TRIGGERS (provenance / audit trail)
-- ============================================================================

-- Logs CREATED on insert.
create or replace function log_memory_created()
returns trigger
language plpgsql
as $$
begin
  insert into memory_events (memory_id, event_type, reason)
  values (new.id, 'CREATED', new.reason);
  return new;
end;
$$;

drop trigger if exists trg_memory_created on memories;
create trigger trg_memory_created
  after insert on memories
  for each row
  execute function log_memory_created();

-- Logs UPDATED / SUPERSEDED / ARCHIVED / STALE on status or content changes.
create or replace function log_memory_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into memory_events (memory_id, event_type, reason)
    values (new.id, new.status::text::memory_event_type, new.reason);
  elsif new.content is distinct from old.content
     or new.embedding is distinct from old.embedding then
    insert into memory_events (memory_id, event_type, reason)
    values (new.id, 'UPDATED', new.reason);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_memory_change on memories;
create trigger trg_memory_change
  after update on memories
  for each row
  execute function log_memory_change();

-- Note: memory_status has ACTIVE plus the three values above; only
-- SUPERSEDED/STALE/ARCHIVED map directly to memory_event_type. ACTIVE
-- transitions (e.g. reactivation) just don't emit one of those three enum
-- values — add an 'ACTIVATED' event type later if you need to track that.


-- ============================================================================
-- 6. RETRIEVAL FUNCTION — the core RAG query
-- ============================================================================

-- match_memories: user-scoped vector similarity search.
--
-- - Always filters by user_id FIRST (hard isolation boundary).
-- - Defaults to ACTIVE memories only.
-- - Excludes expired memories (expires_at in the past) even if still
--   marked ACTIVE, so a maintenance job lagging behind doesn't leak stale
--   context.
-- - Returns similarity as 1 - cosine_distance, so higher = more similar.
-- - Returns memory_id so the backend can attach "why do you know this"
--   provenance to the answer.
create or replace function match_memories(
  p_user_id             uuid,
  p_query_embedding     vector(1536),
  p_top_k               int default 5,
  p_similarity_threshold float default 0.0,
  p_statuses            memory_status[] default array['ACTIVE']::memory_status[]
)
returns table (
  memory_id       uuid,
  content         text,
  similarity      float,
  memory_type     memory_type,
  importance      smallint,
  confidence      numeric,
  status          memory_status,
  created_at      timestamptz,
  last_accessed   timestamptz,
  supersedes_id   uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id                                        as memory_id,
    m.content,
    1 - (m.embedding <=> p_query_embedding)      as similarity,
    m.memory_type,
    m.importance,
    m.confidence,
    m.status,
    m.created_at,
    m.last_accessed,
    m.supersedes_id
  from memories m
  where m.user_id = p_user_id                    -- hard isolation boundary
    and m.status = any (p_statuses)
    and (m.expires_at is null or m.expires_at > now())
    and (1 - (m.embedding <=> p_query_embedding)) >= p_similarity_threshold
  order by m.embedding <=> p_query_embedding asc  -- ascending distance = descending similarity
  limit p_top_k;
$$;

comment on function match_memories is
  'User-scoped pgvector similarity search. Always pass p_user_id explicitly; '
  'never call without it. Read-only — does not update last_accessed or log '
  'ACCESSED events. Call record_memory_access() with the memory IDs actually '
  'used in the final answer for that.';


-- ============================================================================
-- 7. ACCESS / PROVENANCE LOGGING
-- ============================================================================

-- Call this AFTER the AI has generated its answer, with only the memory
-- IDs actually used — this is what "why do you know this" is built from,
-- and it's separate from match_memories so retrieving a candidate doesn't
-- imply it was actually used.
create or replace function record_memory_access(
  p_user_id     uuid,
  p_memory_ids  uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update memories
     set last_accessed = now()
   where id = any (p_memory_ids)
     and user_id = p_user_id;   -- re-assert isolation even here

  insert into memory_events (memory_id, event_type, reason)
  select id, 'ACCESSED', 'used to answer a query'
  from memories
  where id = any (p_memory_ids)
    and user_id = p_user_id;
end;
$$;


-- ============================================================================
-- 8. LIFECYCLE HELPERS
-- ============================================================================

-- Supersede an existing memory with a corrected/updated one, atomically.
-- Old memory -> SUPERSEDED, new row created pointing back via supersedes_id.
create or replace function supersede_memory(
  p_old_memory_id   uuid,
  p_user_id         uuid,
  p_new_content     text,
  p_new_embedding   vector(1536),
  p_memory_type     memory_type default null,
  p_importance      smallint default null,
  p_confidence      numeric default null,
  p_reason          text default 'superseded by newer information'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_old memories%rowtype;
begin
  select * into v_old from memories
   where id = p_old_memory_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'memory % not found for user %', p_old_memory_id, p_user_id;
  end if;

  insert into memories (
    user_id, content, embedding, memory_type, importance, confidence,
    status, reason, supersedes_id
  ) values (
    p_user_id,
    p_new_content,
    p_new_embedding,
    coalesce(p_memory_type, v_old.memory_type),
    coalesce(p_importance, v_old.importance),
    coalesce(p_confidence, v_old.confidence),
    'ACTIVE',
    p_reason,
    p_old_memory_id
  )
  returning id into v_new_id;

  update memories
     set status = 'SUPERSEDED',
         reason = p_reason
   where id = p_old_memory_id;

  return v_new_id;
end;
$$;

-- Maintenance sweep: mark ACTIVE memories STALE once past expires_at.
-- Run on a schedule (Supabase cron / pg_cron / external job scheduler).
create or replace function expire_stale_memories()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with updated as (
    update memories
       set status = 'STALE',
           reason = coalesce(reason, '') || ' [auto-expired]'
     where status = 'ACTIVE'
       and expires_at is not null
       and expires_at <= now()
    returning id
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

-- Example cron registration (requires pg_cron extension enabled in Supabase):
-- select cron.schedule('expire-stale-memories', '0 * * * *', $$select expire_stale_memories();$$);


-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================

-- Two access patterns coexist here:
--   (a) Your backend service connects with the Supabase service_role key
--       and calls match_memories()/record_memory_access() with an explicit
--       p_user_id. Service role bypasses RLS by default — the isolation
--       guarantee for that path lives in the SQL functions above (they all
--       filter by user_id, not by auth context), so keep that filter
--       whenever you touch these tables directly instead of through the
--       functions below.
--   (b) If any client ever queries these tables directly under a
--       Supabase-authenticated (anon/authenticated) role, RLS is the
--       backstop. Enabled below assuming `users.id` equals
--       `auth.uid()` (i.e. users rows are 1:1 with Supabase auth users).

alter table users enable row level security;
alter table memories enable row level security;
alter table memory_events enable row level security;

create policy users_self_select on users
  for select
  using (id = auth.uid());

create policy memories_owner_all on memories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy memory_events_owner_select on memory_events
  for select
  using (
    exists (
      select 1 from memories m
      where m.id = memory_events.memory_id
        and m.user_id = auth.uid()
    )
  );

-- memory_events has no insert/update/delete policy for authenticated/anon
-- roles — writes to it should only happen via the SECURITY DEFINER
-- triggers/functions above, not directly from clients.


-- ============================================================================
-- 10. SAMPLE TEST DATA
-- ============================================================================

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_mem_old uuid;
begin
  insert into users (name) values ('Alice') returning id into v_user_a;
  insert into users (name) values ('Bob')   returning id into v_user_b;

  -- Alice: an ACTIVE fact, using a dummy embedding (all 0.01 for demo —
  -- real embeddings come from your embedding model, not hand-written).
  insert into memories (user_id, content, embedding, memory_type, importance, reason)
  values (
    v_user_a,
    'Alice prefers concise, bullet-point answers.',
    array_fill(0.01, array[1536])::vector,
    'preference',
    4,
    'stated directly by user'
  );

  -- Alice: a memory that will be superseded.
  insert into memories (user_id, content, embedding, memory_type, importance, reason)
  values (
    v_user_a,
    'Alice is working on Project Nova.',
    array_fill(0.02, array[1536])::vector,
    'fact',
    3,
    'stated directly by user'
  )
  returning id into v_mem_old;

  perform supersede_memory(
    v_mem_old,
    v_user_a,
    'Alice is working on Project Nova, now in its integration phase.',
    array_fill(0.021, array[1536])::vector,
    p_reason := 'user gave a status update'
  );

  -- Alice: an expired memory (should never surface in retrieval).
  insert into memories (user_id, content, embedding, memory_type, importance, expires_at, reason)
  values (
    v_user_a,
    'Alice is traveling to Boston next week.',
    array_fill(0.03, array[1536])::vector,
    'event',
    2,
    now() - interval '2 days',
    'time-bound event, now past'
  );

  -- Bob: a memory that must NEVER be retrievable by Alice.
  insert into memories (user_id, content, embedding, memory_type, importance, reason)
  values (
    v_user_b,
    'Bob prefers detailed, technical explanations.',
    array_fill(0.01, array[1536])::vector,
    'preference',
    4,
    'stated directly by user'
  );
end $$;


-- ============================================================================
-- 11. EXAMPLE BACKEND QUERIES
-- ============================================================================

-- (a) Retrieval step — backend calls this after embedding the user's message.
-- In practice p_query_embedding comes from your embedding API call, not a
-- literal like this; shown here just to make the call shape concrete.
--
-- select * from match_memories(
--   p_user_id             := '<alice-uuid>',
--   p_query_embedding     := '[0.01, 0.01, ... ]'::vector(1536),
--   p_top_k               := 5,
--   p_similarity_threshold := 0.75
-- );

-- (b) Provenance step — after the AI answer is generated, tell the DB which
-- of the retrieved candidates were actually used.
--
-- select record_memory_access(
--   '<alice-uuid>',
--   array['<memory-id-1>', '<memory-id-2>']::uuid[]
-- );

-- (c) Sanity check for isolation — this MUST return zero rows for Bob's data
-- when queried as/for Alice:
--
-- select m.id, m.user_id, m.content
-- from match_memories('<alice-uuid>', (select embedding from memories limit 1)) mm
-- join memories m on m.id = mm.memory_id
-- where m.user_id <> '<alice-uuid>';
