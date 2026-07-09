-- Remove legacy generated-analysis markers from existing Slice 1 Supabase projects.
-- New application code generates question seed content through Gemini and keeps Supabase as source of truth.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'practice_takes'
      and pg_get_constraintdef(c.oid) like '%analysis_status%'
  loop
    execute format('alter table public.practice_takes drop constraint %I', constraint_name);
  end loop;
end;
$$;

update public.practice_takes
set analysis_status = 'generated'
where analysis_status = ('moc' || 'ked');

alter table public.practice_takes
  alter column analysis_status set default 'generated';

alter table public.practice_takes
  add constraint practice_takes_analysis_status_check
  check (analysis_status in ('generated', 'failed'));

update public.observations
set source_payload = (source_payload - 'source') || jsonb_build_object('source', 'pre-gemini-migration')
where source_payload ->> 'source' = ('moc' || 'k-analysis');

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
    'generated',
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
    '{"source":"gemini-question-service"}'::jsonb,
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

revoke execute on function public.acttub_create_session_from_upload_intent(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, numeric, integer, integer, text, text, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_create_session_from_upload_intent(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, numeric, integer, integer, text, text, uuid[], timestamptz) to service_role;
