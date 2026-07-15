alter table public.upload_intents
  add column if not exists request_id uuid,
  add column if not exists request_fingerprint text;

alter table public.upload_intents
  drop constraint if exists upload_intents_request_identity_shape;

alter table public.upload_intents
  add constraint upload_intents_request_identity_shape check (
    (request_id is null and request_fingerprint is null)
    or (request_id is not null and request_fingerprint ~ '^[0-9a-f]{64}$')
  );

alter table public.upload_intents
  drop constraint if exists upload_intents_user_request_key;

alter table public.upload_intents
  add constraint upload_intents_user_request_key unique (user_id, request_id);

create or replace function public.acttub_create_upload_intent(
  p_user_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_upload_intent_id uuid,
  p_session_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_expires_at timestamptz
)
returns setof public.upload_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.upload_intents%rowtype;
begin
  insert into public.upload_intents (
    id,
    user_id,
    session_id,
    status,
    expected_storage_bucket,
    expected_storage_path,
    expected_mime_type,
    expected_size_bytes,
    expires_at,
    request_id,
    request_fingerprint
  ) values (
    p_upload_intent_id,
    p_user_id,
    p_session_id,
    'created',
    p_storage_bucket,
    p_storage_path,
    p_mime_type,
    p_size_bytes,
    p_expires_at,
    p_request_id,
    p_request_fingerprint
  )
  on conflict (user_id, request_id) do nothing;

  select *
  into claimed
  from public.upload_intents
  where user_id = p_user_id
    and request_id = p_request_id;

  if not found then
    raise exception 'upload_intent_invalid' using errcode = 'P0001';
  end if;

  if claimed.request_fingerprint is distinct from p_request_fingerprint then
    raise exception 'request_id_conflict' using errcode = 'P0001';
  end if;

  return next claimed;
end
$$;

revoke all on function public.acttub_create_upload_intent(uuid,uuid,text,uuid,uuid,text,text,text,bigint,timestamptz)
  from public, anon, authenticated;
grant execute on function public.acttub_create_upload_intent(uuid,uuid,text,uuid,uuid,text,text,text,bigint,timestamptz)
  to service_role;

drop function if exists public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer);

create function public.acttub_claim_coach_reply(
  p_session_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_request_fingerprint text,
  p_operation_id uuid,
  p_actor_turn_id uuid,
  p_actor_text text,
  p_retry_actor_turn_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer,
  p_expected_ai_turn_id uuid default null
)
returns table(
  operation_id uuid,
  claim_state text,
  acting_session_id text,
  actor_turn_id uuid,
  actor_text text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.practice_interview_runs%rowtype;
  next_ordinal integer;
  replay record;
  replay_turn public.practice_turns%rowtype;
  latest_turn_id uuid;
  latest_turn_role text;
begin
  if p_retry_actor_turn_id is null
    and (nullif(trim(p_actor_text), '') is null or char_length(trim(p_actor_text)) > 2000)
  then
    raise exception 'practice_reply_too_large' using errcode = 'P0001';
  end if;

  if p_lease_seconds <> 120 then
    raise exception 'invalid_lease';
  end if;

  select *
  into replay
  from public.acttub_operation_claim_state(
    p_user_id,
    p_request_id,
    p_request_fingerprint
  );

  if replay.found then
    select *
    into replay_turn
    from public.practice_turns
    where user_id = p_user_id
      and request_id = p_request_id;

    select *
    into r
    from public.practice_interview_runs
    where id = replay.run_id
      and user_id = p_user_id;

    return query
      select replay.operation_id, replay.claim_state, r.acting_session_id,
        replay_turn.id, replay_turn.text;
    return;
  end if;

  select o.id as operation_id
  into replay
  from public.practice_upstream_operations o
  where o.session_id = p_session_id
    and o.user_id = p_user_id
    and o.run_id = p_run_id
    and kind in ('coach_start', 'coach_reply', 'coach_retry_reply')
    and status = 'outcome_unknown'
  order by finished_at desc
  limit 1;

  if found then
    select *
    into r
    from public.practice_interview_runs
    where id = p_run_id
      and session_id = p_session_id
      and user_id = p_user_id;

    return query
      select replay.operation_id, 'outcome_unknown', r.acting_session_id,
        null::uuid, null::text;
    return;
  end if;

  perform public.acttub_preflight_operation(p_session_id, p_user_id, false);

  select *
  into r
  from public.practice_interview_runs
  where id = p_run_id
    and session_id = p_session_id
    and user_id = p_user_id
    and status = 'live'
  for update;

  if not found then
    raise exception 'invalid_run';
  end if;

  if p_retry_actor_turn_id is null then
    if p_expected_ai_turn_id is not null then
      select id, role
      into latest_turn_id, latest_turn_role
      from public.practice_turns
      where session_id = p_session_id
        and run_id = p_run_id
        and user_id = p_user_id
      order by ordinal desc
      limit 1;

      if latest_turn_role is distinct from 'ai'
        or latest_turn_id is distinct from p_expected_ai_turn_id
      then
        raise exception 'stale_ai_turn' using errcode = 'P0001';
      end if;
    end if;

    if exists (
      select 1
      from public.practice_turns
      where session_id = p_session_id
        and run_id = p_run_id
        and user_id = p_user_id
        and role = 'actor'
        and delivery_status = 'pending'
    ) then
      raise exception 'coach_reply_pending' using errcode = 'P0001';
    end if;

    select coalesce(max(ordinal), 0) + 1
    into next_ordinal
    from public.practice_turns
    where session_id = p_session_id
      and run_id = p_run_id;

    insert into public.practice_turns (
      id, session_id, user_id, run_id, ordinal, role,
      delivery_status, request_id, text
    ) values (
      p_actor_turn_id, p_session_id, p_user_id, p_run_id, next_ordinal, 'actor',
      'pending', p_request_id, trim(p_actor_text)
    );
  else
    update public.practice_turns
    set request_id = p_request_id,
      delivery_status = 'pending',
      delivery_error_code = null,
      delivery_retryable = null
    where id = p_retry_actor_turn_id
      and session_id = p_session_id
      and run_id = p_run_id
      and user_id = p_user_id
      and role = 'actor'
      and delivery_status = 'failed'
      and delivery_retryable
    returning text into p_actor_text;

    if not found or nullif(trim(p_actor_text), '') is null then
      raise exception 'retry_actor_not_eligible';
    end if;
    p_actor_turn_id := p_retry_actor_turn_id;
  end if;

  insert into public.practice_upstream_operations (
    id, session_id, user_id, run_id, request_id, request_fingerprint,
    kind, status, lease_token, lease_expires_at
  ) values (
    p_operation_id, p_session_id, p_user_id, p_run_id, p_request_id,
    p_request_fingerprint,
    case when p_retry_actor_turn_id is null then 'coach_reply' else 'coach_retry_reply' end,
    'in_flight', p_lease_token, clock_timestamp() + interval '120 seconds'
  );

  return query
    select p_operation_id, 'claimed', r.acting_session_id,
      p_actor_turn_id, p_actor_text;
end
$$;

revoke all on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer,uuid)
  from public, anon, authenticated;
grant execute on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer,uuid)
  to service_role;

notify pgrst, 'reload schema';
