-- Bound all practice scene inputs, actor replies, and direct RPC entry points.
-- Oversized historical rows block deployment explicitly rather than being silently truncated.

do $$
begin
  if exists (
    select 1
    from public.practice_sessions
    where char_length(situation) > 2000
      or char_length(character_context) > 2000
      or char_length(coalesce(subtext, '')) > 2000
      or char_length(situation)
        + char_length(character_context)
        + char_length(coalesce(subtext, '')) > 4000
  ) then
    raise exception 'practice_scene_context_legacy_rows_require_remediation';
  end if;

  if exists (
    select 1
    from public.practice_turns
    where role = 'actor' and char_length(trim(text)) > 2000
  ) then
    raise exception 'practice_reply_legacy_rows_require_remediation';
  end if;

  if exists (
    select 1
    from public.question_turns
    where speaker = 'actor' and char_length(trim(content)) > 2000
  ) then
    raise exception 'practice_reply_legacy_question_rows_require_remediation';
  end if;
end;
$$;

alter table public.practice_sessions
  add constraint practice_scene_context_within_limits
  check (
    char_length(situation) <= 2000
    and char_length(character_context) <= 2000
    and char_length(coalesce(subtext, '')) <= 2000
    and char_length(situation)
      + char_length(character_context)
      + char_length(coalesce(subtext, '')) <= 4000
  ) not valid;
alter table public.practice_sessions
  validate constraint practice_scene_context_within_limits;

alter table public.practice_turns
  add constraint practice_reply_within_limits
  check (role <> 'actor' or char_length(trim(text)) <= 2000) not valid;
alter table public.practice_turns
  validate constraint practice_reply_within_limits;

alter table public.question_turns
  add constraint practice_reply_legacy_within_limits
  check (speaker <> 'actor' or char_length(trim(content)) <= 2000) not valid;
alter table public.question_turns
  validate constraint practice_reply_legacy_within_limits;

create or replace function public.acttub_create_acting_session(
  p_upload_intent_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_take_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_operation_id uuid,
  p_lease_token uuid,
  p_medium text,
  p_genre text,
  p_situation text,
  p_character_context text,
  p_subtext text,
  p_lease_seconds integer,
  p_created_at timestamptz default now()
)
returns table(operation_id uuid, claim_state text, session_id uuid, analysis_source jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.upload_intents%rowtype;
  replay record;
begin
  if char_length(p_situation) > 2000
    or char_length(p_character_context) > 2000
    or char_length(coalesce(p_subtext, '')) > 2000
    or char_length(p_situation)
      + char_length(p_character_context)
      + char_length(coalesce(p_subtext, '')) > 4000
  then
    raise exception 'practice_scene_context_too_large' using errcode = 'P0001';
  end if;
  if p_lease_seconds <> 780 then raise exception 'invalid_lease'; end if;
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;

  select * into replay
  from public.acttub_operation_claim_state(p_user_id, p_request_id, p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id, replay.claim_state, replay.session_id, replay.response_payload;
    return;
  end if;

  select o.id as operation_id, o.response_payload into replay
  from public.practice_upstream_operations o
  where o.session_id = p_session_id
    and o.user_id = p_user_id
    and kind in ('analysis_create', 'analysis_retry')
    and status = 'outcome_unknown'
  order by finished_at desc
  limit 1;
  if found then
    return query select replay.operation_id, 'outcome_unknown', p_session_id, replay.response_payload;
    return;
  end if;

  perform public.acttub_preflight_operation(p_session_id, p_user_id, false);
  select * into v
  from public.upload_intents
  where id = p_upload_intent_id
    and user_id = p_user_id
    and status = 'finalized'
    and expires_at > clock_timestamp()
  for update;
  if not found or v.session_id <> p_session_id or v.duration_ms is null then
    raise exception 'upload_intent_invalid';
  end if;

  insert into public.practice_sessions(
    id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
    situation, character_context, subtext, created_at, updated_at
  ) values (
    p_session_id, p_user_id, p_upload_intent_id, 'analyzing', 'acting-api-v1',
    p_medium, p_genre, p_situation, p_character_context, p_subtext, p_created_at, p_created_at
  );
  insert into public.practice_takes(
    id, session_id, user_id, storage_bucket, storage_path, mime_type, size_bytes,
    duration_ms, analysis_status, created_at
  ) values (
    p_take_id, p_session_id, p_user_id, v.expected_storage_bucket, v.expected_storage_path,
    v.expected_mime_type, v.expected_size_bytes, v.duration_ms, 'pending', p_created_at
  );
  insert into public.practice_upstream_operations(
    id, session_id, user_id, request_id, request_fingerprint, kind, status,
    lease_token, lease_expires_at, started_at
  ) values (
    p_operation_id, p_session_id, p_user_id, p_request_id, p_request_fingerprint,
    'analysis_create', 'in_flight', p_lease_token,
    clock_timestamp() + interval '780 seconds', clock_timestamp()
  );

  return query select
    p_operation_id,
    'claimed',
    p_session_id,
    jsonb_build_object(
      'storageBucket', v.expected_storage_bucket,
      'storagePath', v.expected_storage_path,
      'mimeType', v.expected_mime_type,
      'sizeBytes', v.expected_size_bytes,
      'situation', p_situation,
      'formattedSituation', p_situation,
      'characterContext', p_character_context,
      'subtext', p_subtext
    );
end;
$$;

create or replace function public.acttub_claim_coach_reply(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_actor_turn_id uuid,p_actor_text text,p_retry_actor_turn_id uuid,p_lease_token uuid,p_lease_seconds integer)
returns table(operation_id uuid,claim_state text,acting_session_id text,actor_turn_id uuid,actor_text text) language plpgsql security definer set search_path=public as $$ declare r public.practice_interview_runs%rowtype; next_ordinal integer; replay record; replay_turn public.practice_turns%rowtype; begin
 if p_retry_actor_turn_id is null
   and (nullif(trim(p_actor_text), '') is null or char_length(trim(p_actor_text)) > 2000)
 then raise exception 'practice_reply_too_large' using errcode = 'P0001'; end if;
 if p_lease_seconds<>120 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint); if replay.found then select * into replay_turn from public.practice_turns where user_id=p_user_id and request_id=p_request_id; select * into r from public.practice_interview_runs where id=replay.run_id and user_id=p_user_id; return query select replay.operation_id,replay.claim_state,r.acting_session_id,replay_turn.id,replay_turn.text; return; end if;
 select o.id as operation_id into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and o.run_id=p_run_id and kind in ('coach_start','coach_reply','coach_retry_reply') and status='outcome_unknown' order by finished_at desc limit 1;
 if found then select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id; return query select replay.operation_id,'outcome_unknown',r.acting_session_id,null::uuid,null::text; return; end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
 select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='live' for update; if not found then raise exception 'invalid_run'; end if;
 if p_retry_actor_turn_id is null then select coalesce(max(ordinal),0)+1 into next_ordinal from public.practice_turns where session_id=p_session_id and run_id=p_run_id; insert into public.practice_turns(id,session_id,user_id,run_id,ordinal,role,delivery_status,request_id,text) values(p_actor_turn_id,p_session_id,p_user_id,p_run_id,next_ordinal,'actor','pending',p_request_id,trim(p_actor_text)); else update public.practice_turns set delivery_status='pending',delivery_error_code=null,delivery_retryable=null where id=p_retry_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and role='actor' and delivery_status='failed' and delivery_retryable returning text into p_actor_text; if not found or nullif(trim(p_actor_text),'') is null then raise exception 'retry_actor_not_eligible'; end if; p_actor_turn_id:=p_retry_actor_turn_id; end if;
 insert into public.practice_upstream_operations(id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at) values(p_operation_id,p_session_id,p_user_id,p_run_id,p_request_id,p_request_fingerprint,case when p_retry_actor_turn_id is null then 'coach_reply' else 'coach_retry_reply' end,'in_flight',p_lease_token,clock_timestamp()+interval '120 seconds'); return query select p_operation_id,'claimed',r.acting_session_id,p_actor_turn_id,p_actor_text; end $$;

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
  if char_length(p_situation) > 2000
    or char_length(p_character_context) > 2000
    or char_length(coalesce(p_subtext, '')) > 2000
    or char_length(p_situation)
      + char_length(p_character_context)
      + char_length(coalesce(p_subtext, '')) > 4000
  then
    raise exception 'practice_scene_context_too_large' using errcode = 'P0001';
  end if;
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
    pipeline_version,
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
    'legacy-gemini-v1',
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

create or replace function public.acttub_append_turn_pair(
  p_session_id uuid,
  p_user_id uuid,
  p_expected_actor_answer_count integer,
  p_actor_turn_id uuid,
  p_actor_content text,
  p_actor_question_focus text,
  p_coach_turn_id uuid,
  p_coach_content text,
  p_coach_question_focus text,
  p_coach_source_observation_ids uuid[],
  p_created_at timestamptz default now()
)
returns table(session_id uuid, actor_answer_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_answer_count integer;
  v_latest_coach_question_focus text;
begin
  if nullif(trim(p_actor_content), '') is null
    or char_length(trim(p_actor_content)) > 2000
  then
    raise exception 'practice_reply_too_large' using errcode = 'P0001';
  end if;
  perform 1
  from public.practice_sessions s
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.hidden_at is null
    and s.pipeline_version = 'legacy-gemini-v1'
    and s.status <> 'completed'
  for update;

  if not found then
    raise exception 'Session is not available for turn append.' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_actor_answer_count
  from public.question_turns qt
  where qt.session_id = p_session_id
    and qt.user_id = p_user_id
    and qt.speaker = 'actor';

  select qt.question_focus
  into v_latest_coach_question_focus
  from public.question_turns qt
  where qt.session_id = p_session_id
    and qt.user_id = p_user_id
    and qt.speaker = 'acttub'
  order by qt.created_at desc, qt.id desc
  limit 1;

  if v_latest_coach_question_focus = 'summary_reflection' then
    raise exception 'Dialogue already ended with a summary reflection.' using errcode = 'P0001';
  end if;

  if v_actor_answer_count >= 10 then
    raise exception 'Dialogue cannot exceed 10 actor answers.' using errcode = 'P0001';
  end if;

  if v_actor_answer_count is distinct from p_expected_actor_answer_count then
    raise exception 'Actor-answer count changed before turn append.' using errcode = 'P0001';
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

  v_actor_answer_count := v_actor_answer_count + 1;
  return query select p_session_id, v_actor_answer_count;
end;
$$;

revoke execute on function public.acttub_create_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_create_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,integer,timestamptz) to service_role;
revoke execute on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer) to service_role;
revoke execute on function public.acttub_create_session_from_upload_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,numeric,integer,integer,text,text,uuid[],timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_create_session_from_upload_intent(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,integer,text,numeric,integer,integer,text,text,uuid[],timestamptz) to service_role;
revoke execute on function public.acttub_append_turn_pair(uuid,uuid,integer,uuid,text,text,uuid,text,text,uuid[],timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_append_turn_pair(uuid,uuid,integer,uuid,text,text,uuid,text,text,uuid[],timestamptz) to service_role;

notify pgrst, 'reload schema';
