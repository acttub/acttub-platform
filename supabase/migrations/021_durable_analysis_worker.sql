-- Durable acting analysis queue. The existing operation table remains the
-- request-identity and replay source of truth during rolling deployment.

alter table public.practice_upstream_operations
  drop constraint practice_upstream_operations_status_check;
alter table public.practice_upstream_operations
  add constraint practice_upstream_operations_status_check
  check (status in ('queued','in_flight','completed','failed','outcome_unknown'));
alter table public.practice_upstream_operations
  alter column lease_token drop not null,
  alter column lease_expires_at drop not null;
alter table public.practice_upstream_operations
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column max_attempts integer not null default 5 check (max_attempts > 0),
  add column available_at timestamptz not null default now(),
  add column last_attempt_at timestamptz;
alter table public.practice_upstream_operations
  add constraint practice_upstream_operations_lease_shape check (
    (status = 'queued' and lease_token is null and lease_expires_at is null)
    or (status = 'in_flight' and lease_token is not null and lease_expires_at is not null)
    or status in ('completed','failed','outcome_unknown')
  );

create unique index practice_upstream_operations_one_active_analysis
  on public.practice_upstream_operations(session_id)
  where kind in ('analysis_create','analysis_retry') and status in ('queued','in_flight');
create index practice_upstream_operations_analysis_claim_order
  on public.practice_upstream_operations(available_at,started_at,id)
  where kind in ('analysis_create','analysis_retry') and status in ('queued','in_flight');

create or replace function public.acttub_operation_claim_state(
  p_user_id uuid, p_request_id uuid, p_request_fingerprint text
) returns table(found boolean, operation_id uuid, session_id uuid, run_id uuid, claim_state text, response_payload jsonb)
language plpgsql security definer set search_path=public as $$
declare existing public.practice_upstream_operations%rowtype;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  select * into existing from public.practice_upstream_operations
    where user_id=p_user_id and request_id=p_request_id for update;
  if not found then
    return query select false,null::uuid,null::uuid,null::uuid,null::text,null::jsonb;
    return;
  end if;
  if existing.request_fingerprint<>p_request_fingerprint then raise exception 'request_id_conflict'; end if;
  if existing.status='in_flight' and existing.lease_expires_at<=clock_timestamp()
     and existing.kind not in ('analysis_create','analysis_retry') then
    perform public.acttub_seal_expired_operation(existing.session_id,existing.user_id,existing.id);
    select * into existing from public.practice_upstream_operations where id=existing.id;
  end if;
  return query select true,existing.id,existing.session_id,existing.run_id,
    case existing.status when 'completed' then 'replay_completed' when 'failed' then 'replay_failed'
      when 'outcome_unknown' then 'outcome_unknown' else 'in_progress' end,
    existing.response_payload;
end $$;

create or replace function public.acttub_enqueue_acting_session(
  p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_request_id uuid,
  p_request_fingerprint text,p_operation_id uuid,p_medium text,p_genre text,
  p_situation text,p_character_context text,p_subtext text,p_created_at timestamptz default now()
) returns table(operation_id uuid,claim_state text,session_id uuid)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype; replay record;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-session:'||p_session_id::text,0));
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id,replay.claim_state,replay.session_id;
    return;
  end if;
  if exists(select 1 from public.practice_upstream_operations operation where operation.session_id=p_session_id
      and operation.user_id=p_user_id and operation.kind in ('analysis_create','analysis_retry')
      and operation.status in ('queued','in_flight')) then raise exception 'operation_in_progress'; end if;
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id
    and status='finalized' and expires_at>clock_timestamp() for update;
  if not found or v.session_id<>p_session_id or v.duration_ms is null then raise exception 'upload_intent_invalid'; end if;
  insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at)
    values(p_session_id,p_user_id,p_upload_intent_id,'analyzing','acting-api-v1',p_medium,p_genre,p_situation,p_character_context,p_subtext,p_created_at,p_created_at);
  insert into public.practice_takes(id,session_id,user_id,storage_bucket,storage_path,mime_type,size_bytes,duration_ms,analysis_status,created_at)
    values(p_take_id,p_session_id,p_user_id,v.expected_storage_bucket,v.expected_storage_path,v.expected_mime_type,v.expected_size_bytes,v.duration_ms,'pending',p_created_at);
  insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at,available_at)
    values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'analysis_create','queued',null,null,clock_timestamp(),clock_timestamp());
  return query select p_operation_id,'claimed',p_session_id;
end $$;

create or replace function public.acttub_enqueue_analysis_retry(
  p_session_id uuid,p_user_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid
) returns table(operation_id uuid,claim_state text,session_id uuid)
language plpgsql security definer set search_path=public as $$
declare replay record;
begin
  perform pg_advisory_xact_lock(hashtextextended('acttub-session:'||p_session_id::text,0));
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then return query select replay.operation_id,replay.claim_state,replay.session_id; return; end if;
  if exists(select 1 from public.practice_upstream_operations operation where operation.session_id=p_session_id
      and operation.user_id=p_user_id and operation.kind in ('analysis_create','analysis_retry')
      and operation.status in ('queued','in_flight')) then raise exception 'operation_in_progress'; end if;
  perform 1 from public.practice_sessions s join public.practice_takes t
    on (t.session_id,t.user_id)=(s.id,s.user_id)
    where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='acting-api-v1'
      and s.status='analyzing' and t.analysis_status='failed' and t.analysis_retryable for update of s,t;
  if not found then raise exception 'invalid_session'; end if;
  insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at,available_at)
    values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'analysis_retry','queued',null,null,clock_timestamp(),clock_timestamp());
  update public.practice_takes as take set analysis_status='pending',analysis_error=null,analysis_retryable=null
    where take.session_id=p_session_id and take.user_id=p_user_id;
  return query select p_operation_id,'claimed',p_session_id;
end $$;

-- Rolling deployments may still run the synchronous retry caller from 013.
-- Recreate its public signature with an explicit pre-021 column list so the
-- four durable-queue columns added above receive their defaults.
create or replace function public.acttub_claim_analysis_retry(
  p_session_id uuid,p_user_id uuid,p_request_id uuid,p_request_fingerprint text,
  p_operation_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns table(operation_id uuid,claim_state text,analysis_source jsonb)
language plpgsql security definer set search_path=public as $$
declare replay record; source jsonb;
begin
  if p_lease_seconds<>780 then raise exception 'invalid_lease'; end if;
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then return query select replay.operation_id,replay.claim_state,replay.response_payload; return; end if;
  select o.id as operation_id,o.response_payload into replay from public.practice_upstream_operations o
    where o.session_id=p_session_id and o.user_id=p_user_id
      and o.kind in ('analysis_create','analysis_retry') and o.status='outcome_unknown'
    order by o.finished_at desc limit 1;
  if found then return query select replay.operation_id,'outcome_unknown',replay.response_payload; return; end if;
  perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
  if not exists(select 1 from public.practice_sessions s join public.practice_takes t
      on (t.session_id,t.user_id)=(s.id,s.user_id) where s.id=p_session_id and s.user_id=p_user_id
      and s.pipeline_version='acting-api-v1' and s.status='analyzing'
      and t.analysis_status='failed' and t.analysis_retryable) then raise exception 'invalid_session'; end if;
  select jsonb_build_object('storageBucket',t.storage_bucket,'storagePath',t.storage_path,
      'mimeType',t.mime_type,'sizeBytes',t.size_bytes,'situation',s.situation,
      'formattedSituation',s.situation,'characterContext',s.character_context,'subtext',s.subtext)
    into source from public.practice_sessions s join public.practice_takes t
      on (t.session_id,t.user_id)=(s.id,s.user_id)
    where s.id=p_session_id and s.user_id=p_user_id;
  insert into public.practice_upstream_operations(
    id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,
    lease_token,lease_expires_at,response_payload,safe_error_code,started_at,finished_at
  ) values (p_operation_id,p_session_id,p_user_id,null,p_request_id,p_request_fingerprint,
    'analysis_retry','in_flight',p_lease_token,clock_timestamp()+interval '780 seconds',
    null,null,clock_timestamp(),null);
  update public.practice_takes set analysis_status='pending',analysis_error=null,analysis_retryable=null
    where session_id=p_session_id and user_id=p_user_id;
  return query select p_operation_id,'claimed',source;
end $$;

create or replace function public.acttub_claim_next_analysis_job(
  p_lease_token uuid,p_lease_seconds integer,p_worker_id text default null
) returns table(operation_id uuid,session_id uuid,user_id uuid,lease_token uuid,attempt_count integer,max_attempts integer,analysis_source jsonb)
language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then raise exception 'invalid_lease'; end if;
  select * into job from public.practice_upstream_operations
    where kind in ('analysis_create','analysis_retry') and (
      (status='queued' and available_at<=clock_timestamp())
      or (status='in_flight' and lease_expires_at<=clock_timestamp())
    )
    order by available_at,started_at,id for update skip locked limit 1;
  if not found then return; end if;
  update public.practice_upstream_operations as claimed set status='in_flight',lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    last_attempt_at=clock_timestamp(),attempt_count=claimed.attempt_count+1
    where id=job.id returning * into job;
  return query select job.id,job.session_id,job.user_id,job.lease_token,job.attempt_count,job.max_attempts,
    jsonb_build_object('storageBucket',t.storage_bucket,'storagePath',t.storage_path,
      'mimeType',t.mime_type,'sizeBytes',t.size_bytes,'medium',s.medium,'genre',s.genre,
      'situation',s.situation,'formattedSituation','[매체: '||s.medium||'] [장르: '||s.genre||'] '||s.situation,
      'characterContext',s.character_context,'subtext',s.subtext)
    from public.practice_sessions s join public.practice_takes t
      on (t.session_id,t.user_id)=(s.id,s.user_id)
    where s.id=job.session_id and s.user_id=job.user_id and s.pipeline_version='acting-api-v1';
end $$;

create or replace function public.acttub_extend_analysis_job_lease(
  p_operation_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then raise exception 'invalid_lease'; end if;
  update public.practice_upstream_operations set
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    where id=p_operation_id and kind in ('analysis_create','analysis_retry')
      and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
  return found;
end $$;

create or replace function public.acttub_requeue_analysis_job(
  p_operation_id uuid,p_lease_token uuid,p_safe_error_code text
) returns text language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; delay_seconds integer;
begin
  select * into job from public.practice_upstream_operations where id=p_operation_id
    and kind in ('analysis_create','analysis_retry') and status='in_flight'
    and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  if job.attempt_count>=job.max_attempts then
    update public.practice_upstream_operations set status='failed',safe_error_code=p_safe_error_code,
      response_payload=public.acttub_error_replay_payload('analysis','definitive',p_safe_error_code,null),
      lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=job.id;
    update public.practice_takes set analysis_status='failed',analysis_error=p_safe_error_code,
      analysis_retryable=true where session_id=job.session_id and user_id=job.user_id;
    return 'failed';
  end if;
  delay_seconds:=least(300,2^greatest(job.attempt_count-1,0));
  update public.practice_upstream_operations set status='queued',safe_error_code=p_safe_error_code,
    lease_token=null,lease_expires_at=null,available_at=clock_timestamp()+make_interval(secs=>delay_seconds)
    where id=job.id;
  return 'queued';
end $$;

create or replace function public.acttub_complete_analysis(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_scene_summary_id uuid,p_summary_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; persisted record;
begin
  select * into job from public.practice_upstream_operations where id=p_operation_id
    and session_id=p_session_id and user_id=p_user_id and kind in ('analysis_create','analysis_retry') for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  if job.status='completed' then
    select id,payload into persisted from public.scene_summaries where session_id=p_session_id and user_id=p_user_id;
    if persisted.id=p_scene_summary_id and persisted.payload=p_summary_payload then return; end if;
    raise exception 'analysis_result_mismatch';
  end if;
  if job.status<>'in_flight' or job.lease_token<>p_lease_token or job.lease_expires_at<=clock_timestamp()
    then raise exception 'stale_analysis_lease'; end if;
  insert into public.scene_summaries values(p_scene_summary_id,p_session_id,p_user_id,p_summary_payload,clock_timestamp());
  update public.practice_takes set analysis_status='completed',analysis_error=null,analysis_retryable=null
    where session_id=p_session_id and user_id=p_user_id;
  update public.practice_sessions set status='interview',updated_at=clock_timestamp()
    where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1';
  update public.practice_upstream_operations set status='completed',
    response_payload=public.acttub_public_session_payload(p_session_id,p_user_id),
    lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=p_operation_id;
end $$;

create or replace function public.acttub_fail_analysis(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_failure_class text,p_safe_error_code text)
returns void language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype;
begin
  if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
  select * into job from public.practice_upstream_operations
    where id=p_operation_id and session_id=p_session_id and user_id=p_user_id
      and kind in ('analysis_create','analysis_retry') and status='in_flight'
      and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  if p_failure_class='ambiguous' and job.attempt_count<>0 then raise exception 'invalid_failure_class'; end if;
  update public.practice_upstream_operations set
    status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,
    safe_error_code=p_safe_error_code,
    response_payload=public.acttub_error_replay_payload('analysis',p_failure_class,p_safe_error_code,null),
    lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=job.id;
  update public.practice_takes set
    analysis_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,
    analysis_error=p_safe_error_code,
    analysis_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited','source_video_unavailable','acting_api_contract_mismatch'))
    where session_id=p_session_id and user_id=p_user_id;
end $$;

revoke all on function public.acttub_enqueue_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.acttub_enqueue_analysis_retry(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.acttub_claim_analysis_retry(uuid,uuid,uuid,text,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.acttub_claim_next_analysis_job(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.acttub_extend_analysis_job_lease(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.acttub_requeue_analysis_job(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.acttub_operation_claim_state(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.acttub_complete_analysis(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.acttub_fail_analysis(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.acttub_enqueue_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.acttub_enqueue_analysis_retry(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.acttub_claim_analysis_retry(uuid,uuid,uuid,text,uuid,uuid,integer) to service_role;
grant execute on function public.acttub_claim_next_analysis_job(uuid,integer,text) to service_role;
grant execute on function public.acttub_extend_analysis_job_lease(uuid,uuid,integer) to service_role;
grant execute on function public.acttub_requeue_analysis_job(uuid,uuid,text) to service_role;
grant execute on function public.acttub_operation_claim_state(uuid,uuid,text) to service_role;
grant execute on function public.acttub_complete_analysis(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.acttub_fail_analysis(uuid,uuid,uuid,uuid,text,text) to service_role;

-- Restore the narrow PostgREST data-plane privileges used by the server-owned
-- session hydrator and pending-profile bootstrap. RLS remains bypassed only by
-- the trusted service_role; browser roles receive no new table privileges.
grant select on table public.profiles,public.upload_intents,public.practice_sessions,
  public.practice_takes,public.scene_summaries,public.practice_interview_runs,
  public.practice_turns,public.practice_reports,public.observations,
  public.question_turns,public.validation_events,public.session_results to service_role;
grant insert on table public.profiles to service_role;

notify pgrst, 'reload schema';
