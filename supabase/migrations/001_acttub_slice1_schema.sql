-- Acttub Slice 1 Supabase schema/RLS/storage policies.
-- Purpose: durable MVP state for question-based acting practice sessions.
-- Product guardrails encoded here:
-- - no score/rating/verdict columns
-- - rejected observations are blocked from later question grounding
-- - final session output is actor-authored text, not an AI conclusion card

begin;

create extension if not exists pgcrypto;

create schema if not exists acttub;

create type acttub.coach_session_status as enum (
  'draft',
  'analyzing',
  'awaiting_observation_confirmation',
  'questioning',
  'summarizing',
  'completed',
  'abandoned'
);

create type acttub.take_analysis_status as enum (
  'pending',
  'processing',
  'succeeded',
  'failed'
);

create type acttub.observation_confirmation_state as enum (
  'unasked',
  'accepted',
  'rejected',
  'unsure'
);

create type acttub.turn_speaker as enum (
  'actor',
  'assistant'
);

create type acttub.turn_state as enum (
  'question',
  'answer',
  'hint',
  'redirect',
  'summary_prompt'
);

create type acttub.question_focus as enum (
  'surface',
  'intention',
  'motivation',
  'situation_emotion',
  'emotion_intensity',
  'expression_intent',
  'gap',
  'missing_context',
  'boundary_redirect'
);

create table acttub.coach_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  anonymous_token text,
  status acttub.coach_session_status not null default 'draft',
  medium text not null,
  genre text not null,
  situation text not null,
  character_context text not null,
  subtext text,
  final_actor_sentence text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_sessions_owner_required check (actor_id is not null or anonymous_token is not null),
  constraint coach_sessions_context_not_blank check (
    length(btrim(medium)) > 0
    and length(btrim(genre)) > 0
    and length(btrim(situation)) > 0
    and length(btrim(character_context)) > 0
  ),
  constraint coach_sessions_final_sentence_not_blank check (
    final_actor_sentence is null or length(btrim(final_actor_sentence)) > 0
  )
);

create table acttub.coach_takes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references acttub.coach_sessions(id) on delete cascade,
  storage_bucket text not null default 'coach-takes',
  storage_key text not null,
  duration_ms integer,
  content_type text,
  analysis_status acttub.take_analysis_status not null default 'pending',
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_takes_duration_positive check (duration_ms is null or duration_ms > 0),
  constraint coach_takes_storage_key_not_blank check (length(btrim(storage_key)) > 0),
  unique (storage_bucket, storage_key)
);

create table acttub.coach_observations (
  id uuid primary key default gen_random_uuid(),
  take_id uuid not null references acttub.coach_takes(id) on delete cascade,
  timestamp_start_ms integer not null,
  timestamp_end_ms integer,
  observation_text text not null,
  confidence numeric(4,3) not null,
  confirmation_state acttub.observation_confirmation_state not null default 'unasked',
  blocked_for_questioning boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_observations_timestamp_valid check (
    timestamp_start_ms >= 0
    and (timestamp_end_ms is null or timestamp_end_ms >= timestamp_start_ms)
  ),
  constraint coach_observations_confidence_valid check (confidence >= 0 and confidence <= 1),
  constraint coach_observations_text_not_blank check (length(btrim(observation_text)) > 0),
  constraint coach_observations_rejected_blocked check (
    confirmation_state <> 'rejected' or blocked_for_questioning = true
  ),
  constraint coach_observations_groundable_only_when_not_blocked check (
    not (confirmation_state = 'accepted' and blocked_for_questioning = true)
  )
);

create table acttub.coach_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references acttub.coach_sessions(id) on delete cascade,
  speaker acttub.turn_speaker not null,
  content text not null,
  question_focus acttub.question_focus,
  source_observation_ids uuid[] not null default '{}',
  turn_state acttub.turn_state not null,
  created_at timestamptz not null default now(),
  constraint coach_turns_content_not_blank check (length(btrim(content)) > 0),
  constraint coach_turns_assistant_question_focus check (
    speaker <> 'assistant' or turn_state <> 'question' or question_focus is not null
  )
);

create table acttub.validation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references acttub.coach_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint validation_events_type_not_blank check (length(btrim(event_type)) > 0)
);

create index coach_sessions_actor_id_created_at_idx on acttub.coach_sessions (actor_id, created_at desc);
create index coach_sessions_anonymous_token_created_at_idx on acttub.coach_sessions (anonymous_token, created_at desc);
create index coach_takes_session_id_idx on acttub.coach_takes (session_id);
create index coach_observations_take_id_state_idx on acttub.coach_observations (take_id, confirmation_state, blocked_for_questioning);
create index coach_turns_session_id_created_at_idx on acttub.coach_turns (session_id, created_at asc);
create index validation_events_session_id_created_at_idx on acttub.validation_events (session_id, created_at asc);

create or replace function acttub.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger coach_sessions_set_updated_at
before update on acttub.coach_sessions
for each row execute function acttub.set_updated_at();

create trigger coach_takes_set_updated_at
before update on acttub.coach_takes
for each row execute function acttub.set_updated_at();

create trigger coach_observations_set_updated_at
before update on acttub.coach_observations
for each row execute function acttub.set_updated_at();

create or replace function acttub.observation_belongs_to_actor(observation_id uuid, user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = acttub, public
as $$
  select exists (
    select 1
    from acttub.coach_observations o
    join acttub.coach_takes t on t.id = o.take_id
    join acttub.coach_sessions s on s.id = t.session_id
    where o.id = observation_id
      and s.actor_id = user_id
  );
$$;

create or replace function acttub.enforce_turn_source_observations_groundable()
returns trigger
language plpgsql
security definer
set search_path = acttub, public
as $$
declare
  unsafe_count integer;
begin
  if coalesce(array_length(new.source_observation_ids, 1), 0) = 0 then
    return new;
  end if;

  select count(*) into unsafe_count
  from unnest(new.source_observation_ids) as source_id
  left join acttub.coach_observations o on o.id = source_id
  left join acttub.coach_takes t on t.id = o.take_id
  where o.id is null
    or t.session_id <> new.session_id
    or o.confirmation_state <> 'accepted'
    or o.blocked_for_questioning = true;

  if unsafe_count > 0 then
    raise exception 'assistant turn source observations must belong to the session and be accepted/non-blocked';
  end if;

  return new;
end;
$$;

create trigger coach_turns_enforce_source_observations_groundable
before insert or update of session_id, source_observation_ids on acttub.coach_turns
for each row execute function acttub.enforce_turn_source_observations_groundable();

alter table acttub.coach_sessions enable row level security;
alter table acttub.coach_takes enable row level security;
alter table acttub.coach_observations enable row level security;
alter table acttub.coach_turns enable row level security;
alter table acttub.validation_events enable row level security;

create policy coach_sessions_actor_select on acttub.coach_sessions
  for select using (actor_id = auth.uid());
create policy coach_sessions_actor_insert on acttub.coach_sessions
  for insert with check (actor_id = auth.uid());
create policy coach_sessions_actor_update on acttub.coach_sessions
  for update using (actor_id = auth.uid()) with check (actor_id = auth.uid());

create policy coach_takes_actor_all on acttub.coach_takes
  for all using (
    exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  );

create policy coach_observations_actor_all on acttub.coach_observations
  for all using (
    exists (
      select 1
      from acttub.coach_takes t
      join acttub.coach_sessions s on s.id = t.session_id
      where t.id = take_id and s.actor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from acttub.coach_takes t
      join acttub.coach_sessions s on s.id = t.session_id
      where t.id = take_id and s.actor_id = auth.uid()
    )
  );

create policy coach_turns_actor_all on acttub.coach_turns
  for all using (
    exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  );

create policy validation_events_actor_insert on acttub.validation_events
  for insert with check (
    session_id is null
    or exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  );
create policy validation_events_actor_select on acttub.validation_events
  for select using (
    session_id is null
    or exists (
      select 1 from acttub.coach_sessions s
      where s.id = session_id and s.actor_id = auth.uid()
    )
  );

-- Service-role-only operational access is intentionally not represented as RLS policies.
-- Supabase service role bypasses RLS for server-side analysis jobs and Spring Boot migration workers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'coach-takes',
  'coach-takes',
  false,
  524288000,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy coach_takes_storage_actor_read on storage.objects
  for select using (
    bucket_id = 'coach-takes'
    and owner = auth.uid()
  );

create policy coach_takes_storage_actor_insert on storage.objects
  for insert with check (
    bucket_id = 'coach-takes'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy coach_takes_storage_actor_update on storage.objects
  for update using (
    bucket_id = 'coach-takes'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'coach-takes'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy coach_takes_storage_actor_delete on storage.objects
  for delete using (
    bucket_id = 'coach-takes'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
