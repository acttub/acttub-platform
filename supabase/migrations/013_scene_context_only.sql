-- The active acting-api contract collects only situation, character context, and
-- subtext. medium/genre parameters stay in the private RPC signature solely for
-- rolling compatibility with the shared legacy table and completed replay DTOs.
-- formattedSituation temporarily remains as a private rolling-deploy alias, but
-- now contains the raw situation without medium/genre prefixes.

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

create or replace function public.acttub_claim_analysis_retry(
  p_session_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns table(operation_id uuid, claim_state text, analysis_source jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  replay record;
  source jsonb;
begin
  if p_lease_seconds <> 780 then raise exception 'invalid_lease'; end if;
  select * into replay
  from public.acttub_operation_claim_state(p_user_id, p_request_id, p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id, replay.claim_state, replay.response_payload;
    return;
  end if;
  select o.id as operation_id, o.response_payload into replay
  from public.practice_upstream_operations o
  where o.session_id = p_session_id
    and o.user_id = p_user_id
    and o.kind in ('analysis_create', 'analysis_retry')
    and status = 'outcome_unknown'
  order by finished_at desc
  limit 1;
  if found then
    return query select replay.operation_id, 'outcome_unknown', replay.response_payload;
    return;
  end if;

  perform public.acttub_preflight_operation(p_session_id, p_user_id, false);
  if not exists(
    select 1
    from public.practice_sessions s
    join public.practice_takes t on (t.session_id, t.user_id) = (s.id, s.user_id)
    where s.id = p_session_id
      and s.user_id = p_user_id
      and s.pipeline_version = 'acting-api-v1'
      and s.status = 'analyzing'
      and t.analysis_status = 'failed'
      and t.analysis_retryable
  ) then
    raise exception 'invalid_session';
  end if;

  select jsonb_build_object(
    'storageBucket', t.storage_bucket,
    'storagePath', t.storage_path,
    'mimeType', t.mime_type,
    'sizeBytes', t.size_bytes,
    'situation', s.situation,
    'formattedSituation', s.situation,
    'characterContext', s.character_context,
    'subtext', s.subtext
  ) into source
  from public.practice_sessions s
  join public.practice_takes t on (t.session_id, t.user_id) = (s.id, s.user_id)
  where s.id = p_session_id and s.user_id = p_user_id;

  insert into public.practice_upstream_operations
  values (
    p_operation_id, p_session_id, p_user_id, null, p_request_id, p_request_fingerprint,
    'analysis_retry', 'in_flight', p_lease_token,
    clock_timestamp() + interval '780 seconds', null, null, clock_timestamp(), null
  );
  update public.practice_takes
  set analysis_status = 'pending', analysis_error = null, analysis_retryable = null
  where session_id = p_session_id and user_id = p_user_id;
  return query select p_operation_id, 'claimed', source;
end;
$$;

create or replace function public.acttub_claim_coach_start(
  p_session_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_operation_id uuid,
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer,
  p_restart boolean
)
returns table(
  operation_id uuid,
  claim_state text,
  run_id uuid,
  summary_payload jsonb,
  coach_context jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.practice_sessions%rowtype;
  summary jsonb;
  prior uuid;
  replay record;
  previous public.practice_interview_runs%rowtype;
begin
  if p_lease_seconds <> 120 then raise exception 'invalid_lease'; end if;
  select * into replay
  from public.acttub_operation_claim_state(p_user_id, p_request_id, p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id, replay.claim_state, replay.run_id, replay.response_payload, null::jsonb;
    return;
  end if;
  if not p_restart then
    select o.id as operation_id, o.run_id, o.response_payload into replay
    from public.practice_upstream_operations o
    where o.session_id = p_session_id
      and o.user_id = p_user_id
      and kind in ('coach_start', 'coach_reply', 'coach_retry_reply')
      and status = 'outcome_unknown'
    order by finished_at desc
    limit 1;
    if found then
      return query select replay.operation_id, 'outcome_unknown', replay.run_id, replay.response_payload, null::jsonb;
      return;
    end if;
  end if;

  perform public.acttub_preflight_operation(p_session_id, p_user_id, false);
  select * into s
  from public.practice_sessions
  where id = p_session_id and user_id = p_user_id and pipeline_version = 'acting-api-v1'
  for update;
  if not found or s.status <> 'interview' then raise exception 'invalid_session'; end if;
  select payload into summary
  from public.scene_summaries
  where session_id = p_session_id and user_id = p_user_id;
  prior := s.interview_run_id;
  if prior is not null then
    select * into previous
    from public.practice_interview_runs
    where id = prior and user_id = p_user_id;
  end if;
  if p_restart and (
    previous.id is null
    or not (
      previous.status in ('expired', 'outcome_unknown')
      or (previous.status = 'start_failed' and previous.start_mode = 'restart' and previous.failure_retryable)
    )
  ) then raise exception 'restart_not_allowed'; end if;
  if not p_restart
    and previous.id is not null
    and not (
      previous.status = 'start_failed'
      and previous.start_mode = 'initial'
      and previous.failure_retryable
    )
  then raise exception 'start_not_allowed'; end if;

  insert into public.practice_interview_runs(
    id, session_id, user_id, status, start_mode, restart_of_run_id
  ) values (
    p_run_id, p_session_id, p_user_id, 'starting',
    case when p_restart then 'restart' else 'initial' end,
    case
      when p_restart and previous.status = 'start_failed' and previous.start_mode = 'restart'
        then previous.restart_of_run_id
      when p_restart then prior
      else null
    end
  );
  update public.practice_sessions
  set interview_run_id = p_run_id
  where id = p_session_id and user_id = p_user_id;
  insert into public.practice_upstream_operations(
    id, session_id, user_id, run_id, request_id, request_fingerprint, kind, status,
    lease_token, lease_expires_at
  ) values (
    p_operation_id, p_session_id, p_user_id, p_run_id, p_request_id,
    p_request_fingerprint,
    case when p_restart then 'coach_restart' else 'coach_start' end,
    'in_flight', p_lease_token, clock_timestamp() + interval '120 seconds'
  );

  return query select
    p_operation_id,
    'claimed',
    p_run_id,
    summary,
    jsonb_build_object(
      'situation', s.situation,
      'formattedSituation', s.situation,
      'characterContext', s.character_context,
      'subtext', s.subtext
    );
end;
$$;

create or replace function public.acttub_claim_report(
  p_session_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns table(operation_id uuid, claim_state text, coach_session_payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  replay record;
  payload jsonb;
begin
  if p_lease_seconds <> 120 then raise exception 'invalid_lease'; end if;
  select * into replay
  from public.acttub_operation_claim_state(p_user_id, p_request_id, p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id, replay.claim_state, replay.response_payload;
    return;
  end if;
  select o.id as operation_id, o.response_payload into replay
  from public.practice_upstream_operations o
  where o.session_id = p_session_id
    and o.user_id = p_user_id
    and o.kind = 'report'
    and status = 'outcome_unknown'
  order by finished_at desc
  limit 1;
  if found then
    return query select replay.operation_id, 'outcome_unknown', replay.response_payload;
    return;
  end if;
  perform public.acttub_preflight_operation(p_session_id, p_user_id, true);
  select * into replay
  from public.practice_upstream_operations
  where session_id = p_session_id
    and user_id = p_user_id
    and kind = 'report'
    and status = 'failed'
    and safe_error_code not in ('acting_api_auth_failed', 'acting_api_rate_limited')
  order by finished_at desc
  limit 1;
  if found then
    return query select replay.id, 'replay_failed', replay.response_payload;
    return;
  end if;
  if exists(
    select 1
    from public.practice_upstream_operations
    where session_id = p_session_id
      and user_id = p_user_id
      and kind = 'report'
      and status = 'outcome_unknown'
  ) then raise exception 'report_outcome_unknown'; end if;

  select jsonb_build_object(
    'user_id', s.user_id,
    'session', jsonb_build_object(
      'session_id', r.acting_session_id,
      'summary', ss.payload,
      'subtext', jsonb_build_object(
        'situation', s.situation,
        'character', s.character_context,
        'subtext', s.subtext
      ),
      'turns', coalesce((
        select jsonb_agg(jsonb_build_object('role', t.role, 'text', t.text) order by t.ordinal)
        from public.practice_turns t
        where t.session_id = s.id
          and t.run_id = r.id
          and t.user_id = s.user_id
          and t.delivery_status = 'completed'
      ), '[]'::jsonb),
      'question_count', (
        select count(*)
        from public.practice_turns t
        where t.session_id = s.id
          and t.run_id = r.id
          and t.user_id = s.user_id
          and t.role = 'ai'
          and t.delivery_status = 'completed'
      ),
      'status', 'closed',
      'close_reason', coalesce(r.close_reason, '')
    )
  ) into payload
  from public.practice_sessions s
  join public.scene_summaries ss on (ss.session_id, ss.user_id) = (s.id, s.user_id)
  join public.practice_interview_runs r
    on (r.session_id, r.id, r.user_id) = (s.id, s.interview_run_id, s.user_id)
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.pipeline_version = 'acting-api-v1'
    and s.status = 'report'
    and r.status = 'completed';
  if payload is null then raise exception 'invalid_session'; end if;

  insert into public.practice_upstream_operations(
    id, session_id, user_id, request_id, request_fingerprint, kind, status,
    lease_token, lease_expires_at
  ) values (
    p_operation_id, p_session_id, p_user_id, p_request_id, p_request_fingerprint,
    'report', 'in_flight', p_lease_token, clock_timestamp() + interval '120 seconds'
  );
  return query select p_operation_id, 'claimed', payload;
end;
$$;

do $$
declare
  signature regprocedure;
begin
  foreach signature in array array[
    'public.acttub_create_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,integer,timestamptz)'::regprocedure,
    'public.acttub_claim_analysis_retry(uuid,uuid,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.acttub_claim_coach_start(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,boolean)'::regprocedure,
    'public.acttub_claim_report(uuid,uuid,uuid,text,uuid,uuid,integer)'::regprocedure
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
