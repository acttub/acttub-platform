-- Acting uploads remain client-compatible, but only a lease-fenced worker probe
-- can make their bytes authoritative and eligible for upstream analysis.

alter table public.upload_intents
  add column reported_duration_ms integer
  check (reported_duration_ms is null or reported_duration_ms between 1 and 180000);
alter table public.practice_takes
  add column reported_duration_ms integer
  check (reported_duration_ms is null or reported_duration_ms between 1 and 180000);

alter table public.upload_intents drop constraint upload_intents_status_check;
alter table public.upload_intents add constraint upload_intents_status_check
  check (status in ('created','validating','validation_failed','finalized','expired','cleanup_failed'));

create or replace function public.acttub_finalize_upload_intent(
  p_upload_intent_id uuid,p_user_id uuid,p_storage_path text,p_duration_ms integer
) returns table(upload_intent_id uuid,session_id uuid,duration_ms integer)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype;
begin
  if p_duration_ms not between 1 and 180000 then raise exception 'invalid_duration'; end if;
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id for update;
  if not found or v.expected_storage_path<>p_storage_path or v.expires_at<=clock_timestamp() then raise exception 'upload_intent_invalid'; end if;
  if v.status in ('validating','finalized') and coalesce(v.reported_duration_ms,v.duration_ms)=p_duration_ms then
    return query select v.id,v.session_id,p_duration_ms; return;
  end if;
  if v.status<>'created' then raise exception 'upload_intent_invalid'; end if;
  update public.upload_intents set status='validating',reported_duration_ms=p_duration_ms,
    duration_ms=null,authoritative_duration_ms=null,media_metadata_version=null,
    ai_eligible_at=null,finalized_at=null,updated_at=clock_timestamp() where id=v.id;
  return query select v.id,v.session_id,p_duration_ms;
end $$;

create or replace function public.acttub_enqueue_acting_session(
  p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_request_id uuid,
  p_request_fingerprint text,p_operation_id uuid,p_medium text,p_genre text,
  p_situation text,p_character_context text,p_subtext text,p_created_at timestamptz default now()
) returns table(operation_id uuid,claim_state text,session_id uuid)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype; replay record; report integer;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-session:'||p_session_id::text,0));
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then return query select replay.operation_id,replay.claim_state,replay.session_id; return; end if;
  if exists(select 1 from public.practice_upstream_operations operation where operation.session_id=p_session_id
      and operation.user_id=p_user_id and operation.kind in ('analysis_create','analysis_retry')
      and operation.status in ('queued','in_flight')) then raise exception 'operation_in_progress'; end if;
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id
    and status in ('validating','finalized') and expires_at>clock_timestamp() for update;
  report:=coalesce(v.reported_duration_ms,v.duration_ms);
  if not found or v.session_id<>p_session_id or report is null or report not between 1 and 180000 then raise exception 'upload_intent_invalid'; end if;
  insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at)
    values(p_session_id,p_user_id,p_upload_intent_id,'analyzing','acting-api-v1',p_medium,p_genre,p_situation,p_character_context,p_subtext,p_created_at,p_created_at);
  insert into public.practice_takes(id,session_id,user_id,storage_bucket,storage_path,mime_type,size_bytes,duration_ms,reported_duration_ms,analysis_status,created_at)
    values(p_take_id,p_session_id,p_user_id,v.expected_storage_bucket,v.expected_storage_path,v.expected_mime_type,v.expected_size_bytes,null,report,'pending',p_created_at);
  insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at,available_at)
    values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'analysis_create','queued',null,null,clock_timestamp(),clock_timestamp());
  return query select p_operation_id,'claimed',p_session_id;
end $$;

-- Old G010 workers may only claim work whose authoritative marker already
-- exists. New unvalidated rows are exclusively visible through the v2 claim.
create or replace function public.acttub_claim_next_analysis_job(
  p_lease_token uuid,p_lease_seconds integer,p_worker_id text default null
) returns table(operation_id uuid,session_id uuid,user_id uuid,lease_token uuid,attempt_count integer,max_attempts integer,analysis_source jsonb)
language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then raise exception 'invalid_lease'; end if;
  select o.* into job from public.practice_upstream_operations o
    join public.practice_sessions s on (s.id,s.user_id)=(o.session_id,o.user_id)
    join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
    join public.upload_intents u on (u.id,u.user_id)=(s.upload_intent_id,s.user_id)
    where o.kind in ('analysis_create','analysis_retry')
      and t.duration_ms between 1 and 180000 and t.media_metadata_version='iso-bmff-duration.v1'
      and u.ai_eligible_at is not null and u.authoritative_duration_ms=t.duration_ms
      and ((o.status='queued' and o.available_at<=clock_timestamp()) or (o.status='in_flight' and o.lease_expires_at<=clock_timestamp()))
    order by o.available_at,o.started_at,o.id for update of o skip locked limit 1;
  if not found then return; end if;
  update public.practice_upstream_operations claimed set status='in_flight',lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_attempt_at=clock_timestamp(),attempt_count=claimed.attempt_count+1
    where id=job.id returning * into job;
  return query select job.id,job.session_id,job.user_id,job.lease_token,job.attempt_count,job.max_attempts,
    jsonb_build_object('storageBucket',t.storage_bucket,'storagePath',t.storage_path,'mimeType',t.mime_type,'sizeBytes',t.size_bytes,
      'medium',s.medium,'genre',s.genre,'situation',s.situation,
      'formattedSituation','[매체: '||s.medium||'] [장르: '||s.genre||'] '||s.situation,
      'characterContext',s.character_context,'subtext',s.subtext)
    from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
    where s.id=job.session_id and s.user_id=job.user_id;
end $$;

create or replace function public.acttub_claim_next_analysis_job_v2(
  p_lease_token uuid,p_lease_seconds integer,p_worker_id text default null
) returns table(operation_id uuid,session_id uuid,user_id uuid,lease_token uuid,attempt_count integer,max_attempts integer,analysis_source jsonb)
language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then raise exception 'invalid_lease'; end if;
  select o.* into job from public.practice_upstream_operations o
    join public.practice_sessions s on (s.id,s.user_id)=(o.session_id,o.user_id)
    join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
    join public.upload_intents u on (u.id,u.user_id)=(s.upload_intent_id,s.user_id)
    where s.pipeline_version='acting-api-v1' and o.kind in ('analysis_create','analysis_retry') and (
      (o.status='queued' and o.available_at<=clock_timestamp()) or
      (o.status='in_flight' and o.lease_expires_at<=clock_timestamp()))
    order by o.available_at,o.started_at,o.id for update skip locked limit 1;
  if not found then return; end if;
  update public.practice_upstream_operations claimed set status='in_flight',lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_attempt_at=clock_timestamp(),attempt_count=claimed.attempt_count+1
    where id=job.id returning * into job;
  return query select job.id,job.session_id,job.user_id,job.lease_token,job.attempt_count,job.max_attempts,
    jsonb_build_object('storageBucket',t.storage_bucket,'storagePath',t.storage_path,'mimeType',t.mime_type,'sizeBytes',t.size_bytes,
      'situation',s.situation,'characterContext',s.character_context,'subtext',s.subtext,
      'authoritativeDurationMs',t.duration_ms,'mediaMetadataVersion',t.media_metadata_version,'aiEligibleAt',u.ai_eligible_at)
    from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
      join public.upload_intents u on (u.id,u.user_id)=(s.upload_intent_id,s.user_id)
    where s.id=job.session_id and s.user_id=job.user_id and s.pipeline_version='acting-api-v1';
end $$;

create or replace function public.acttub_record_trusted_media_probe(
  p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,
  p_authoritative_duration_ms integer,p_media_metadata_version text
) returns void language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; u public.upload_intents%rowtype; t public.practice_takes%rowtype;
begin
  if p_authoritative_duration_ms not between 1 and 180000 or p_media_metadata_version<>'iso-bmff-duration.v1' then raise exception 'invalid_media_metadata'; end if;
  select * into job from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id
    and kind in ('analysis_create','analysis_retry') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  select upload.* into u from public.upload_intents upload join public.practice_sessions s on (s.upload_intent_id,s.user_id)=(upload.id,upload.user_id)
    where s.id=p_session_id and s.user_id=p_user_id for update of upload;
  select * into t from public.practice_takes where session_id=p_session_id and user_id=p_user_id for update;
  if u.authoritative_duration_ms is not null or t.duration_ms is not null then
    if u.authoritative_duration_ms=p_authoritative_duration_ms and t.duration_ms=p_authoritative_duration_ms
       and u.media_metadata_version=p_media_metadata_version and t.media_metadata_version=p_media_metadata_version then return; end if;
    raise exception 'media_probe_mismatch';
  end if;
  update public.upload_intents set duration_ms=p_authoritative_duration_ms,authoritative_duration_ms=p_authoritative_duration_ms,
    media_metadata_version=p_media_metadata_version,ai_eligible_at=clock_timestamp(),status='finalized',
    finalized_at=clock_timestamp(),updated_at=clock_timestamp() where id=u.id;
  update public.practice_takes set duration_ms=p_authoritative_duration_ms,media_metadata_version=p_media_metadata_version
    where id=t.id;
end $$;

create or replace function public.acttub_fail_trusted_media_validation(
  p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_safe_error_code text
) returns void language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; upload_id uuid;
begin
  if p_safe_error_code not in ('video_too_long','source_video_metadata_invalid') then raise exception 'invalid_media_failure'; end if;
  select * into job from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id
    and kind in ('analysis_create','analysis_retry') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  select upload_intent_id into upload_id from public.practice_sessions where id=p_session_id and user_id=p_user_id for update;
  update public.upload_intents set status='validation_failed',duration_ms=null,authoritative_duration_ms=null,
    media_metadata_version=null,ai_eligible_at=null,finalized_at=null,updated_at=clock_timestamp() where id=upload_id and user_id=p_user_id;
  update public.practice_takes set duration_ms=null,media_metadata_version=null,analysis_status='failed',
    analysis_error=p_safe_error_code,analysis_retryable=false where session_id=p_session_id and user_id=p_user_id;
  update public.practice_upstream_operations set status='failed',safe_error_code=p_safe_error_code,
    response_payload=public.acttub_error_replay_payload('analysis','definitive',p_safe_error_code,null),
    lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=job.id;
end $$;

create or replace function public.acttub_public_session_payload(p_session_id uuid,p_user_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',s.id,'userId',s.user_id,'pipelineVersion','acting-api-v1','legacy',false,'status',upper(s.status),'medium',s.medium,'genre',s.genre,'situation',s.situation,'characterContext',s.character_context,'subtext',coalesce(s.subtext,''),'hiddenAt',s.hidden_at,'createdAt',s.created_at,'updatedAt',s.updated_at,
 'take',jsonb_build_object('id',t.id,'durationMs',coalesce(t.duration_ms,t.reported_duration_ms),'analysisStatus',t.analysis_status,'analysisError',t.analysis_error,'analysisRetryable',coalesce(t.analysis_retryable,false),'createdAt',t.created_at),
 'sceneSummary',ss.payload,
 'currentRun',case when r.id is null then null else jsonb_build_object('runId',r.id,'status',r.status,'closeReason',r.close_reason,'failureCode',r.failure_code,'failureRetryable',coalesce(r.failure_retryable,false),'recoveryAction',case when r.status in ('expired','outcome_unknown') then 'restart' when r.status='start_failed' and r.failure_retryable then case r.start_mode when 'restart' then 'restart' else 'start' end else null end) end,
 'turns',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'runId',x.run_id,'ordinal',x.ordinal,'role',x.role,'text',x.text,'deliveryStatus',x.delivery_status,'deliveryErrorCode',x.delivery_error_code,'deliveryRetryable',coalesce(x.delivery_retryable,false),'action',x.action,'focusTimestamp',x.focus_timestamp,'createdAt',x.created_at) order by x.ordinal) from public.practice_turns x where x.session_id=s.id and x.user_id=s.user_id and x.run_id=s.interview_run_id),'[]'::jsonb),
 'report',public.acttub_public_report_payload(s.id,s.user_id))
 from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id) left join public.scene_summaries ss on (ss.session_id,ss.user_id)=(s.id,s.user_id) left join public.practice_interview_runs r on (r.session_id,r.id,r.user_id)=(s.id,s.interview_run_id,s.user_id) where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='acting-api-v1'
$$;

revoke all on function public.acttub_claim_next_analysis_job_v2(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.acttub_record_trusted_media_probe(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.acttub_fail_trusted_media_validation(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.acttub_claim_next_analysis_job_v2(uuid,integer,text) to service_role;
grant execute on function public.acttub_record_trusted_media_probe(uuid,uuid,uuid,uuid,integer,text) to service_role;
grant execute on function public.acttub_fail_trusted_media_validation(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
