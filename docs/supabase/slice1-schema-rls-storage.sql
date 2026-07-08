-- Acttub Slice 1 Supabase schema, RLS, and private Storage policy artifact.
-- Apply through Supabase migrations after review in a project with auth + storage schemas.
-- Product invariants:
-- 1. Practice videos live only in a private bucket.
-- 2. Browser JWT can INSERT only the exact object path from an active upload intent.
-- 3. Browser JWT has no SELECT/UPDATE/DELETE policy for practice videos in Slice 1.
-- 4. Playback must use the server signed-url endpoint after ownership checks.

create extension if not exists pgcrypto;

create or replace function public.current_acttub_terms_version()
returns text
language sql
stable
as $$
  select '2026-07-mvp'::text;
$$;

create or replace function public.is_active_acttub_profile(profile_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = profile_user_id
      and p.status = 'active'
      and p.terms_accepted_at is not null
      and p.privacy_accepted_at is not null
      and p.internal_review_consent_at is not null
      and p.consent_version = public.current_acttub_terms_version()
  );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default 'pending_terms'
    check (status in ('pending_terms', 'active', 'suspended')),
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  internal_review_consent_at timestamptz,
  consent_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint active_profile_requires_current_consent check (
    status <> 'active'
    or (
      terms_accepted_at is not null
      and privacy_accepted_at is not null
      and internal_review_consent_at is not null
      and consent_version = public.current_acttub_terms_version()
    )
  )
);

create table if not exists public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null default gen_random_uuid(),
  status text not null default 'created'
    check (status in ('created', 'finalized', 'expired', 'cleanup_failed')),
  expected_storage_bucket text not null default 'practice-videos',
  expected_storage_path text not null unique,
  expected_mime_type text not null check (expected_mime_type in ('video/mp4', 'video/quicktime')),
  expected_size_bytes bigint not null check (expected_size_bytes > 0 and expected_size_bytes <= 314572800),
  consent_version text not null default public.current_acttub_terms_version(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (session_id, user_id),
  constraint upload_intent_path_shape check (
    expected_storage_path = 'users/' || user_id::text || '/practice-sessions/' || session_id::text || '/take.' ||
      case expected_mime_type
        when 'video/mp4' then 'mp4'
        when 'video/quicktime' then 'mov'
      end
  )
);

create table if not exists public.practice_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  upload_intent_id uuid not null,
  status text not null default 'observations_pending'
    check (status in ('observations_pending', 'questioning', 'completed')),
  medium text not null,
  genre text not null,
  situation text not null,
  character_context text not null,
  subtext text,
  final_actor_sentence text,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (upload_intent_id, user_id) references public.upload_intents(id, user_id),
  constraint final_sentence_required_when_completed check (
    status <> 'completed' or nullif(trim(final_actor_sentence), '') is not null
  )
);

create table if not exists public.practice_takes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  storage_bucket text not null default 'practice-videos',
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('video/mp4', 'video/quicktime')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 314572800),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  analysis_status text not null default 'mocked'
    check (analysis_status in ('mocked', 'failed')),
  analysis_error text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.practice_sessions(id, user_id) on delete cascade
);

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  take_id uuid not null,
  user_id uuid not null,
  timestamp_start_ms integer not null check (timestamp_start_ms >= 0),
  timestamp_end_ms integer check (timestamp_end_ms is null or timestamp_end_ms >= timestamp_start_ms),
  observation_text text not null,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  confirmation_state text not null default 'unasked'
    check (confirmation_state in ('unasked', 'accepted', 'rejected', 'unsure')),
  blocked_for_questioning boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.practice_sessions(id, user_id) on delete cascade,
  foreign key (take_id, user_id) references public.practice_takes(id, user_id) on delete cascade,
  constraint rejected_observations_are_blocked check (
    confirmation_state <> 'rejected' or blocked_for_questioning = true
  ),
  constraint accepted_observations_are_not_blocked check (
    confirmation_state <> 'accepted' or blocked_for_questioning = false
  )
);

create table if not exists public.question_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  speaker text not null check (speaker in ('actor', 'acttub')),
  content text not null,
  question_focus text,
  source_observation_ids uuid[] not null default '{}',
  turn_state text not null default 'open' check (turn_state in ('open', 'answered', 'summary')),
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.practice_sessions(id, user_id) on delete cascade
);

create table if not exists public.session_results (
  session_id uuid primary key,
  user_id uuid not null,
  actor_authored_sentence text not null check (length(trim(actor_authored_sentence)) > 0),
  question_to_revisit text,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.practice_sessions(id, user_id) on delete cascade
);

create table if not exists public.validation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.practice_sessions(id, user_id) on delete cascade
);


create or replace function public.acttub_create_session_from_upload_intent(
  p_upload_intent_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_take_id uuid,
  p_observation_id uuid,
  p_first_question_id uuid,
  p_medium text,
  p_genre text,
  p_situation text,
  p_character_context text,
  p_subtext text,
  p_duration_ms integer,
  p_observation_text text,
  p_observation_confidence numeric,
  p_observation_timestamp_start_ms integer,
  p_observation_timestamp_end_ms integer,
  p_first_question_content text,
  p_first_question_focus text,
  p_first_question_source_observation_ids uuid[],
  p_created_at timestamptz default now()
)
returns table(session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload_intent public.upload_intents%rowtype;
begin
  select * into v_upload_intent
  from public.upload_intents ui
  where ui.id = p_upload_intent_id
    and ui.user_id = p_user_id
    and ui.session_id = p_session_id
    and ui.status = 'created'
    and ui.expires_at > now()
  for update;

  if not found then
    raise exception 'Upload intent is not available for atomic session creation.'
      using errcode = 'P0001';
  end if;

  update public.upload_intents
  set status = 'finalized',
      finalized_at = coalesce(finalized_at, p_created_at),
      updated_at = p_created_at
  where id = p_upload_intent_id
    and user_id = p_user_id;

  insert into public.practice_sessions (
    id,
    user_id,
    upload_intent_id,
    status,
    medium,
    genre,
    situation,
    character_context,
    subtext,
    final_actor_sentence,
    hidden_at,
    created_at,
    updated_at
  ) values (
    p_session_id,
    p_user_id,
    p_upload_intent_id,
    'observations_pending',
    p_medium,
    p_genre,
    p_situation,
    p_character_context,
    nullif(p_subtext, ''),
    null,
    null,
    p_created_at,
    p_created_at
  );

  insert into public.practice_takes (
    id,
    session_id,
    user_id,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    duration_ms,
    analysis_status,
    analysis_error,
    created_at
  ) values (
    p_take_id,
    p_session_id,
    p_user_id,
    v_upload_intent.expected_storage_bucket,
    v_upload_intent.expected_storage_path,
    v_upload_intent.expected_mime_type,
    v_upload_intent.expected_size_bytes,
    p_duration_ms,
    'mocked',
    null,
    p_created_at
  );

  insert into public.observations (
    id,
    session_id,
    take_id,
    user_id,
    timestamp_start_ms,
    timestamp_end_ms,
    observation_text,
    confidence,
    confirmation_state,
    blocked_for_questioning,
    source_payload,
    created_at
  ) values (
    p_observation_id,
    p_session_id,
    p_take_id,
    p_user_id,
    p_observation_timestamp_start_ms,
    p_observation_timestamp_end_ms,
    p_observation_text,
    p_observation_confidence,
    'unasked',
    false,
    '{"source":"mock-analysis"}'::jsonb,
    p_created_at
  );

  insert into public.question_turns (
    id,
    session_id,
    user_id,
    speaker,
    content,
    question_focus,
    source_observation_ids,
    turn_state,
    created_at
  ) values (
    p_first_question_id,
    p_session_id,
    p_user_id,
    'acttub',
    p_first_question_content,
    p_first_question_focus,
    p_first_question_source_observation_ids,
    'open',
    p_created_at
  );

  return query select p_session_id;
end;
$$;

create or replace function public.acttub_append_turn_pair(
  p_session_id uuid,
  p_user_id uuid,
  p_actor_turn_id uuid,
  p_actor_content text,
  p_actor_question_focus text,
  p_coach_turn_id uuid,
  p_coach_content text,
  p_coach_question_focus text,
  p_coach_source_observation_ids uuid[],
  p_created_at timestamptz default now()
)
returns table(session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.practice_sessions s
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.hidden_at is null
    and s.status <> 'completed'
  for update;

  if not found then
    raise exception 'Session is not available for turn append.' using errcode = 'P0001';
  end if;

  insert into public.question_turns (
    id, session_id, user_id, speaker, content, question_focus, source_observation_ids, turn_state, created_at
  ) values (
    p_actor_turn_id, p_session_id, p_user_id, 'actor', p_actor_content, p_actor_question_focus, '{}', 'answered', p_created_at
  );

  insert into public.question_turns (
    id, session_id, user_id, speaker, content, question_focus, source_observation_ids, turn_state, created_at
  ) values (
    p_coach_turn_id, p_session_id, p_user_id, 'acttub', p_coach_content, p_coach_question_focus, p_coach_source_observation_ids, 'open', p_created_at
  );

  update public.practice_sessions
  set status = 'questioning', updated_at = p_created_at
  where id = p_session_id and user_id = p_user_id;

  return query select p_session_id;
end;
$$;

create or replace function public.acttub_complete_session(
  p_session_id uuid,
  p_user_id uuid,
  p_final_actor_sentence text,
  p_validation_metrics jsonb,
  p_question_to_revisit text
)
returns table(session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz := now();
begin
  perform 1
  from public.practice_sessions s
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.hidden_at is null
    and s.status <> 'completed'
  for update;

  if not found then
    raise exception 'Session is not available for completion.' using errcode = 'P0001';
  end if;

  update public.practice_sessions
  set status = 'completed',
      final_actor_sentence = p_final_actor_sentence,
      updated_at = v_completed_at
  where id = p_session_id and user_id = p_user_id;

  insert into public.session_results (
    session_id, user_id, actor_authored_sentence, question_to_revisit, created_at
  ) values (
    p_session_id, p_user_id, p_final_actor_sentence, p_question_to_revisit, v_completed_at
  );

  insert into public.validation_events (
    session_id, user_id, event_type, payload, created_at
  ) values (
    p_session_id, p_user_id, 'validation_metrics', p_validation_metrics, v_completed_at
  );

  return query select p_session_id;
end;
$$;


revoke execute on function public.acttub_create_session_from_upload_intent(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, numeric, integer, integer, text, text, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_create_session_from_upload_intent(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, numeric, integer, integer, text, text, uuid[], timestamptz) to service_role;

revoke execute on function public.acttub_append_turn_pair(uuid, uuid, uuid, text, text, uuid, text, text, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_append_turn_pair(uuid, uuid, uuid, text, text, uuid, text, text, uuid[], timestamptz) to service_role;

revoke execute on function public.acttub_complete_session(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.acttub_complete_session(uuid, uuid, text, jsonb, text) to service_role;

alter table public.profiles enable row level security;
alter table public.upload_intents enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_takes enable row level security;
alter table public.observations enable row level security;
alter table public.question_turns enable row level security;
alter table public.session_results enable row level security;
alter table public.validation_events enable row level security;

create policy "profiles owner select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles owner insert self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles owner update terms"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "upload intents owner select active"
  on public.upload_intents for select
  to authenticated
  using (user_id = auth.uid());

create policy "practice sessions owner select visible"
  on public.practice_sessions for select
  to authenticated
  using (user_id = auth.uid() and hidden_at is null);

create policy "practice sessions owner soft hide"
  on public.practice_sessions for update
  to authenticated
  using (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()))
  with check (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()));

create policy "practice takes owner select visible session"
  on public.practice_takes for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.practice_sessions s
      where s.id = practice_takes.session_id
        and s.user_id = auth.uid()
        and s.hidden_at is null
    )
  );

create policy "observations owner crud"
  on public.observations for all
  to authenticated
  using (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()))
  with check (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()));

create policy "question turns owner crud"
  on public.question_turns for all
  to authenticated
  using (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()))
  with check (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()));

create policy "session results owner crud"
  on public.session_results for all
  to authenticated
  using (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()))
  with check (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()));

create policy "validation events owner insert select"
  on public.validation_events for all
  to authenticated
  using (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()))
  with check (user_id = auth.uid() and public.is_active_acttub_profile(auth.uid()));

-- Private bucket setup. Supabase Storage buckets are private by default, but the flag is explicit here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'practice-videos',
  'practice-videos',
  false,
  314572800,
  array['video/mp4', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Browser upload authority: INSERT only, exact path only, active/current consent only, unexpired intent only.
create policy "practice videos insert via active upload intent"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'practice-videos'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'practice-sessions'
    and (storage.filename(name) in ('take.mp4', 'take.mov'))
    and public.is_active_acttub_profile(auth.uid())
    and exists (
      select 1
      from public.upload_intents ui
      where ui.user_id = auth.uid()
        and ui.status = 'created'
        and ui.consent_version = public.current_acttub_terms_version()
        and ui.expected_storage_bucket = storage.objects.bucket_id
        and ui.expected_storage_path = storage.objects.name
        and ui.expires_at > now()
    )
  );

-- Intentionally absent in Slice 1:
-- - no storage.objects SELECT policy for practice-videos (no browser download/list/signing path)
-- - no storage.objects UPDATE policy (no browser upsert/move)
-- - no storage.objects DELETE policy (cleanup is server-only via service role Storage API)

commit;
