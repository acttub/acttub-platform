-- Acting API pipeline persistence. Apply only through a reviewed deployment migration.
-- This file intentionally contains no project identifiers, credentials, or signed URLs.

alter table public.upload_intents add column if not exists duration_ms integer;
alter table public.upload_intents drop constraint if exists upload_intents_expected_size_bytes_check;
alter table public.upload_intents add constraint upload_intents_expected_size_bytes_check
  check (expected_size_bytes > 0 and expected_size_bytes <= 576716800);
alter table public.upload_intents drop constraint if exists upload_intents_duration_ms_check;
alter table public.upload_intents add constraint upload_intents_duration_ms_check
  check (duration_ms is null or duration_ms between 1 and 180000);

alter table public.practice_takes drop constraint if exists practice_takes_size_bytes_check;
alter table public.practice_takes add constraint practice_takes_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 576716800);
alter table public.practice_takes drop constraint if exists practice_takes_duration_ms_check;
alter table public.practice_takes add constraint practice_takes_duration_ms_check
  check (duration_ms is null or duration_ms between 1 and 180000);
alter table public.practice_takes drop constraint if exists practice_takes_analysis_status_check;
alter table public.practice_takes add constraint practice_takes_analysis_status_check
  check (analysis_status in ('generated','pending','completed','failed','outcome_unknown'));
alter table public.practice_takes add column if not exists analysis_retryable boolean;

alter table public.practice_sessions add column if not exists pipeline_version text;
update public.practice_sessions set pipeline_version = 'legacy-gemini-v1' where pipeline_version is null;
alter table public.practice_sessions alter column pipeline_version set default 'legacy-gemini-v1';
alter table public.practice_sessions alter column pipeline_version set not null;
alter table public.practice_sessions add column if not exists interview_run_id uuid;
alter table public.practice_sessions drop constraint if exists practice_sessions_status_check;
alter table public.practice_sessions add constraint practice_sessions_status_check
  check (status in ('observations_pending','questioning','completed','analyzing','interview','report','end'));
alter table public.practice_sessions add constraint practice_sessions_pipeline_version_check
  check (pipeline_version in ('legacy-gemini-v1','acting-api-v1'));

-- Compatibility guards: migration-002/003 callers continue to create legacy rows
-- through the legacy default, but cannot move acting-api rows through legacy states.
create or replace function public.acttub_guard_legacy_session_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.pipeline_version='acting-api-v1'
     and new.status in ('observations_pending','questioning','completed') then
    raise exception 'acting_pipeline_requires_acting_rpcs';
  end if;
  return new;
end $$;
drop trigger if exists acttub_guard_legacy_session_mutation on public.practice_sessions;
create trigger acttub_guard_legacy_session_mutation before update on public.practice_sessions
for each row execute function public.acttub_guard_legacy_session_mutation();

create or replace function public.acttub_guard_legacy_child_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.practice_sessions s where s.id=new.session_id and s.pipeline_version='acting-api-v1') then
    raise exception 'acting_pipeline_requires_acting_rpcs';
  end if;
  return new;
end $$;
drop trigger if exists acttub_guard_legacy_question_turn on public.question_turns;
create trigger acttub_guard_legacy_question_turn before insert or update on public.question_turns
for each row execute function public.acttub_guard_legacy_child_mutation();
drop trigger if exists acttub_guard_legacy_session_result on public.session_results;
create trigger acttub_guard_legacy_session_result before insert or update on public.session_results
for each row execute function public.acttub_guard_legacy_child_mutation();

update storage.buckets set file_size_limit = 576716800
where id = 'practice-videos';

create table public.scene_summaries (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (session_id), unique (id,user_id),
  foreign key (session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade
);

create table public.practice_interview_runs (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  acting_session_id text,
  status text not null check (status in ('starting','live','completed','start_failed','expired','outcome_unknown')),
  start_mode text not null check (start_mode in ('initial','restart')),
  restart_of_run_id uuid,
  close_reason text,
  failure_code text,
  failure_retryable boolean,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (id,user_id), unique (session_id,id,user_id),
  foreign key (session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade
);
alter table public.practice_interview_runs add constraint practice_interview_runs_restart_same_session_fk
  foreign key (session_id,restart_of_run_id,user_id)
  references public.practice_interview_runs(session_id,id,user_id);
create unique index practice_interview_runs_one_live
  on public.practice_interview_runs(session_id) where status in ('starting','live');
alter table public.practice_sessions add constraint practice_sessions_interview_run_fk
  foreign key (id,interview_run_id,user_id) references public.practice_interview_runs(session_id,id,user_id);

create table public.practice_turns (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  run_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  role text not null check (role in ('actor','ai')),
  delivery_status text not null check (delivery_status in ('pending','completed','failed','outcome_unknown')),
  delivery_error_code text,
  delivery_retryable boolean,
  request_id uuid,
  text text not null check (length(trim(text)) > 0),
  action text,
  focus_timestamp text,
  created_at timestamptz not null default now(),
  unique (id,user_id), unique (session_id,run_id,ordinal), unique (user_id,request_id),
  foreign key (session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
  foreign key (session_id,run_id,user_id) references public.practice_interview_runs(session_id,id,user_id) on delete cascade,
  check (role <> 'ai' or delivery_status = 'completed')
);

create table public.practice_reports (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  payload jsonb not null,
  report_count integer not null check (report_count > 0),
  created_at timestamptz not null default now(),
  unique (session_id), unique (id,user_id),
  foreign key (session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade
);

create table public.practice_upstream_operations (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  run_id uuid,
  request_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('analysis_create','analysis_retry','coach_start','coach_restart','coach_reply','coach_retry_reply','report')),
  status text not null check (status in ('in_flight','completed','failed','outcome_unknown')),
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  safe_error_code text,
  response_payload jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id,request_id), unique (id,user_id),
  foreign key (session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
  foreign key (session_id,run_id,user_id) references public.practice_interview_runs(session_id,id,user_id)
);
create unique index practice_upstream_operations_one_session_flight
  on public.practice_upstream_operations(session_id) where status='in_flight';
create unique index practice_upstream_operations_one_user_report
  on public.practice_upstream_operations(user_id) where kind='report' and status='in_flight';

create or replace function public.acttub_error_replay_payload(
  p_phase text,p_failure_class text,p_safe_error_code text,p_run_id uuid default null
) returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'status',case
      when p_safe_error_code='acting_api_rate_limited' then 429
      when p_safe_error_code in ('video_too_large','acting_video_too_large') then 413
      when p_safe_error_code in ('acting_api_auth_failed','acting_api_rejected') then 502
      else 409 end,
    'error',jsonb_build_object(
      'code',case when p_failure_class='ambiguous' then
        case p_phase when 'analysis' then 'analysis_outcome_unknown' when 'report' then 'report_outcome_unknown' else 'upstream_outcome_unknown' end
        else p_safe_error_code end
    ) || case
      when p_failure_class='ambiguous' then jsonb_build_object('details',jsonb_strip_nulls(jsonb_build_object(
        'causeCode',p_safe_error_code,
        'retryAllowed',false,
        'action',case when p_phase='analysis' then 'create_new_session' when p_phase='report' then 'contact_support' else 'restart_interview' end,
        'runId',case when p_phase='coach' then p_run_id end
      )))
      when p_safe_error_code='acting_session_expired' then jsonb_build_object('details',jsonb_strip_nulls(jsonb_build_object(
        'action','restart_interview','runId',p_run_id
      )))
      else '{}'::jsonb
    end
  )
$$;

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
  if existing.status='in_flight' and existing.lease_expires_at<=clock_timestamp() then
    perform public.acttub_seal_expired_operation(existing.session_id,existing.user_id,existing.id);
    select * into existing from public.practice_upstream_operations where id=existing.id;
  end if;
  return query select true,existing.id,existing.session_id,existing.run_id,
    case existing.status when 'completed' then 'replay_completed' when 'failed' then 'replay_failed'
      when 'outcome_unknown' then 'outcome_unknown' else 'in_progress' end,
    existing.response_payload;
end $$;

create or replace function public.acttub_preflight_operation(p_session_id uuid,p_user_id uuid,p_report boolean) returns void language plpgsql security definer set search_path=public as $$
declare op record;
begin
  -- Stable xact locks make the preflight + later domain mutation one serialized claim boundary.
  perform pg_advisory_xact_lock(hashtextextended('acttub-session:'||p_session_id::text,0));
  if p_report then perform pg_advisory_xact_lock(hashtextextended('acttub-report-user:'||p_user_id::text,0)); end if;
  for op in
    select id,session_id,user_id from public.practice_upstream_operations
    where status='in_flight' and lease_expires_at<=clock_timestamp()
      and (session_id=p_session_id or (p_report and user_id=p_user_id and kind='report'))
    order by id for update
  loop
    perform public.acttub_seal_expired_operation(op.session_id,op.user_id,op.id);
  end loop;
  if exists(select 1 from public.practice_upstream_operations where status='in_flight'
      and lease_expires_at>clock_timestamp()
      and (session_id=p_session_id or (p_report and user_id=p_user_id and kind='report'))) then
    raise exception 'operation_in_progress';
  end if;
end $$;

alter table public.scene_summaries enable row level security;
alter table public.practice_interview_runs enable row level security;
alter table public.practice_turns enable row level security;
alter table public.practice_reports enable row level security;
alter table public.practice_upstream_operations enable row level security;
revoke all on public.scene_summaries, public.practice_interview_runs, public.practice_turns,
  public.practice_reports, public.practice_upstream_operations from anon, authenticated;
grant select,insert,update,delete on public.scene_summaries, public.practice_interview_runs,
  public.practice_turns, public.practice_reports, public.practice_upstream_operations to service_role;

create or replace function public.acttub_finalize_upload_intent(
  p_upload_intent_id uuid,p_user_id uuid,p_storage_path text,p_duration_ms integer
) returns table(upload_intent_id uuid,session_id uuid,duration_ms integer)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype;
begin
  if p_duration_ms not between 1 and 180000 then raise exception 'invalid_duration'; end if;
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id for update;
  if not found or v.expected_storage_path<>p_storage_path or v.expires_at<=clock_timestamp() then raise exception 'upload_intent_invalid'; end if;
  if v.status='finalized' and v.duration_ms=p_duration_ms then return query select v.id,v.session_id,v.duration_ms; return; end if;
  if v.status<>'created' then raise exception 'upload_intent_invalid'; end if;
  update public.upload_intents set status='finalized',duration_ms=p_duration_ms,finalized_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id;
  return query select v.id,v.session_id,p_duration_ms;
end $$;

create or replace function public.acttub_create_acting_session(
  p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_request_id uuid,
  p_request_fingerprint text,p_operation_id uuid,p_lease_token uuid,p_medium text,p_genre text,
  p_situation text,p_character_context text,p_subtext text,p_lease_seconds integer,p_created_at timestamptz default now()
) returns table(operation_id uuid,claim_state text,session_id uuid,analysis_source jsonb)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype; replay record;
begin
  if p_lease_seconds<>780 then raise exception 'invalid_lease'; end if;
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then
    return query select replay.operation_id,replay.claim_state,replay.session_id,replay.response_payload;
    return;
  end if;
  select o.id as operation_id,o.response_payload into replay from public.practice_upstream_operations o
    where o.session_id=p_session_id and o.user_id=p_user_id and kind in ('analysis_create','analysis_retry') and status='outcome_unknown'
    order by finished_at desc limit 1;
  if found then return query select replay.operation_id,'outcome_unknown',p_session_id,replay.response_payload; return; end if;
  perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id and status='finalized' and expires_at>clock_timestamp() for update;
  if not found or v.session_id<>p_session_id or v.duration_ms is null then raise exception 'upload_intent_invalid'; end if;
  insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at)
    values(p_session_id,p_user_id,p_upload_intent_id,'analyzing','acting-api-v1',p_medium,p_genre,p_situation,p_character_context,p_subtext,p_created_at,p_created_at);
  insert into public.practice_takes(id,session_id,user_id,storage_bucket,storage_path,mime_type,size_bytes,duration_ms,analysis_status,created_at)
    values(p_take_id,p_session_id,p_user_id,v.expected_storage_bucket,v.expected_storage_path,v.expected_mime_type,v.expected_size_bytes,v.duration_ms,'pending',p_created_at);
  insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at)
    values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'analysis_create','in_flight',p_lease_token,clock_timestamp()+interval '780 seconds',clock_timestamp());
  return query select p_operation_id,'claimed',p_session_id,jsonb_build_object('storageBucket',v.expected_storage_bucket,'storagePath',v.expected_storage_path,'mimeType',v.expected_mime_type,'sizeBytes',v.expected_size_bytes,'medium',p_medium,'genre',p_genre,'situation',p_situation,'formattedSituation','[매체: '||p_medium||'] [장르: '||p_genre||'] '||p_situation,'characterContext',p_character_context,'subtext',p_subtext);
end $$;

-- The remaining transition RPCs use the same private lease boundary. Their exact
-- signatures are stable so the application can migrate to Spring Boot unchanged.
create or replace function public.acttub_claim_analysis_retry(p_session_id uuid,p_user_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_lease_token uuid,p_lease_seconds integer)
returns table(operation_id uuid,claim_state text,analysis_source jsonb) language plpgsql security definer set search_path=public as $$
declare replay record; source jsonb;
begin
 if p_lease_seconds<>780 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
 if replay.found then return query select replay.operation_id,replay.claim_state,replay.response_payload; return; end if;
 select o.id as operation_id,o.response_payload into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and o.kind in ('analysis_create','analysis_retry') and status='outcome_unknown' order by finished_at desc limit 1;
 if found then return query select replay.operation_id,'outcome_unknown',replay.response_payload; return; end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
 if not exists(select 1 from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id) where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='acting-api-v1' and s.status='analyzing' and t.analysis_status='failed' and t.analysis_retryable) then raise exception 'invalid_session'; end if;
 select jsonb_build_object('storageBucket',t.storage_bucket,'storagePath',t.storage_path,'mimeType',t.mime_type,'sizeBytes',t.size_bytes,'medium',s.medium,'genre',s.genre,'situation',s.situation,'formattedSituation','[매체: '||s.medium||'] [장르: '||s.genre||'] '||s.situation,'characterContext',s.character_context,'subtext',s.subtext) into source from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id) where s.id=p_session_id and s.user_id=p_user_id;
 insert into public.practice_upstream_operations values(p_operation_id,p_session_id,p_user_id,null,p_request_id,p_request_fingerprint,'analysis_retry','in_flight',p_lease_token,clock_timestamp()+interval '780 seconds',null,null,clock_timestamp(),null);
 update public.practice_takes set analysis_status='pending',analysis_error=null,analysis_retryable=null where session_id=p_session_id and user_id=p_user_id;
 return query select p_operation_id,'claimed',source; end $$;

create or replace function public.acttub_public_report_payload(p_session_id uuid,p_user_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('headline',r.payload->>'headline','biggestProblem',jsonb_build_object('start',r.payload#>>'{biggest_problem,start}','end',r.payload#>>'{biggest_problem,end}','dimension',r.payload#>>'{biggest_problem,dimension}','description',r.payload#>>'{biggest_problem,description}'),'evidence',r.payload->>'evidence','selfDiscovery',r.payload->>'self_discovery','encouragement',r.payload->>'encouragement','nextStep',r.payload->>'next_step','comparison',r.payload->>'comparison','reportCount',r.report_count) from public.practice_reports r where r.session_id=p_session_id and r.user_id=p_user_id
$$;

create or replace function public.acttub_public_session_payload(p_session_id uuid,p_user_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',s.id,'userId',s.user_id,'pipelineVersion','acting-api-v1','legacy',false,'status',upper(s.status),'medium',s.medium,'genre',s.genre,'situation',s.situation,'characterContext',s.character_context,'subtext',coalesce(s.subtext,''),'hiddenAt',s.hidden_at,'createdAt',s.created_at,'updatedAt',s.updated_at,
 'take',jsonb_build_object('id',t.id,'durationMs',t.duration_ms,'analysisStatus',t.analysis_status,'analysisError',t.analysis_error,'analysisRetryable',coalesce(t.analysis_retryable,false),'createdAt',t.created_at),
 'sceneSummary',ss.payload,
 'currentRun',case when r.id is null then null else jsonb_build_object('runId',r.id,'status',r.status,'closeReason',r.close_reason,'failureCode',r.failure_code,'failureRetryable',coalesce(r.failure_retryable,false),'recoveryAction',case when r.status in ('expired','outcome_unknown') then 'restart' when r.status='start_failed' and r.failure_retryable then case r.start_mode when 'restart' then 'restart' else 'start' end else null end) end,
 'turns',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'runId',x.run_id,'ordinal',x.ordinal,'role',x.role,'text',x.text,'deliveryStatus',x.delivery_status,'deliveryErrorCode',x.delivery_error_code,'deliveryRetryable',coalesce(x.delivery_retryable,false),'action',x.action,'focusTimestamp',x.focus_timestamp,'createdAt',x.created_at) order by x.ordinal) from public.practice_turns x where x.session_id=s.id and x.user_id=s.user_id and x.run_id=s.interview_run_id),'[]'::jsonb),
 'report',public.acttub_public_report_payload(s.id,s.user_id))
 from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id) left join public.scene_summaries ss on (ss.session_id,ss.user_id)=(s.id,s.user_id) left join public.practice_interview_runs r on (r.session_id,r.id,r.user_id)=(s.id,s.interview_run_id,s.user_id) where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='acting-api-v1'
$$;

create or replace function public.acttub_complete_analysis(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_scene_summary_id uuid,p_summary_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id and kind in ('analysis_create','analysis_retry') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update; if not found then raise exception 'upstream_outcome_unknown'; end if;
 insert into public.scene_summaries values(p_scene_summary_id,p_session_id,p_user_id,p_summary_payload,clock_timestamp()); update public.practice_takes set analysis_status='completed',analysis_error=null,analysis_retryable=null where session_id=p_session_id and user_id=p_user_id; update public.practice_sessions set status='interview',updated_at=clock_timestamp() where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1';
 update public.practice_upstream_operations set status='completed',response_payload=public.acttub_public_session_payload(p_session_id,p_user_id),finished_at=clock_timestamp() where id=p_operation_id;
end $$;

create or replace function public.acttub_fail_analysis(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_failure_class text,p_safe_error_code text)
returns void language plpgsql security definer set search_path=public as $$ begin
 if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
 update public.practice_upstream_operations set status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,
   safe_error_code=p_safe_error_code,response_payload=public.acttub_error_replay_payload('analysis',p_failure_class,p_safe_error_code,null),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and user_id=p_user_id and kind in ('analysis_create','analysis_retry') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_takes set analysis_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,analysis_error=p_safe_error_code,analysis_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited')) where session_id=p_session_id and user_id=p_user_id;
end $$;

-- Claim/finalize functions below deliberately keep private payloads in service-role results only.
create or replace function public.acttub_claim_coach_start(p_session_id uuid,p_user_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_run_id uuid,p_lease_token uuid,p_lease_seconds integer,p_restart boolean)
returns table(operation_id uuid,claim_state text,run_id uuid,summary_payload jsonb,coach_context jsonb) language plpgsql security definer set search_path=public as $$ declare s public.practice_sessions%rowtype; summary jsonb; prior uuid; replay record; previous public.practice_interview_runs%rowtype; begin
 if p_lease_seconds<>120 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint); if replay.found then return query select replay.operation_id,replay.claim_state,replay.run_id,replay.response_payload,null::jsonb; return; end if;
 if not p_restart then
   select o.id as operation_id,o.run_id,o.response_payload into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and kind in ('coach_start','coach_reply','coach_retry_reply') and status='outcome_unknown' order by finished_at desc limit 1;
   if found then return query select replay.operation_id,'outcome_unknown',replay.run_id,replay.response_payload,null::jsonb; return; end if;
 end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
 select * into s from public.practice_sessions where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1' for update; if not found or s.status<>'interview' then raise exception 'invalid_session'; end if; select payload into summary from public.scene_summaries where session_id=p_session_id and user_id=p_user_id; prior:=s.interview_run_id;
 if prior is not null then select * into previous from public.practice_interview_runs where id=prior and user_id=p_user_id; end if;
 if p_restart and (previous.id is null or not (previous.status in ('expired','outcome_unknown') or (previous.status='start_failed' and previous.start_mode='restart' and previous.failure_retryable))) then raise exception 'restart_not_allowed'; end if;
 if not p_restart and previous.id is not null and not (previous.status='start_failed' and previous.start_mode='initial' and previous.failure_retryable) then raise exception 'start_not_allowed'; end if;
 insert into public.practice_interview_runs(id,session_id,user_id,status,start_mode,restart_of_run_id) values(p_run_id,p_session_id,p_user_id,'starting',case when p_restart then 'restart' else 'initial' end,case when p_restart and previous.status='start_failed' and previous.start_mode='restart' then previous.restart_of_run_id when p_restart then prior else null end); update public.practice_sessions set interview_run_id=p_run_id where id=p_session_id and user_id=p_user_id;
 insert into public.practice_upstream_operations(id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at) values(p_operation_id,p_session_id,p_user_id,p_run_id,p_request_id,p_request_fingerprint,case when p_restart then 'coach_restart' else 'coach_start' end,'in_flight',p_lease_token,clock_timestamp()+interval '120 seconds');
 return query select p_operation_id,'claimed',p_run_id,summary,jsonb_build_object('medium',s.medium,'genre',s.genre,'situation',s.situation,'formattedSituation','[매체: '||s.medium||'] [장르: '||s.genre||'] '||s.situation,'characterContext',s.character_context,'subtext',s.subtext); end $$;

create or replace function public.acttub_claim_coach_reply(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_actor_turn_id uuid,p_actor_text text,p_retry_actor_turn_id uuid,p_lease_token uuid,p_lease_seconds integer)
returns table(operation_id uuid,claim_state text,acting_session_id text,actor_turn_id uuid,actor_text text) language plpgsql security definer set search_path=public as $$ declare r public.practice_interview_runs%rowtype; next_ordinal integer; replay record; replay_turn public.practice_turns%rowtype; begin
 if p_lease_seconds<>120 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint); if replay.found then select * into replay_turn from public.practice_turns where user_id=p_user_id and request_id=p_request_id; select * into r from public.practice_interview_runs where id=replay.run_id and user_id=p_user_id; return query select replay.operation_id,replay.claim_state,r.acting_session_id,replay_turn.id,replay_turn.text; return; end if;
 select o.id as operation_id into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and o.run_id=p_run_id and kind in ('coach_start','coach_reply','coach_retry_reply') and status='outcome_unknown' order by finished_at desc limit 1;
 if found then select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id; return query select replay.operation_id,'outcome_unknown',r.acting_session_id,null::uuid,null::text; return; end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
 select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='live' for update; if not found then raise exception 'invalid_run'; end if;
 if p_retry_actor_turn_id is null then select coalesce(max(ordinal),0)+1 into next_ordinal from public.practice_turns where session_id=p_session_id and run_id=p_run_id; insert into public.practice_turns(id,session_id,user_id,run_id,ordinal,role,delivery_status,request_id,text) values(p_actor_turn_id,p_session_id,p_user_id,p_run_id,next_ordinal,'actor','pending',p_request_id,trim(p_actor_text)); else update public.practice_turns set delivery_status='pending',delivery_error_code=null,delivery_retryable=null where id=p_retry_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and role='actor' and delivery_status='failed' and delivery_retryable returning text into p_actor_text; if not found or nullif(trim(p_actor_text),'') is null then raise exception 'retry_actor_not_eligible'; end if; p_actor_turn_id:=p_retry_actor_turn_id; end if;
 insert into public.practice_upstream_operations(id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at) values(p_operation_id,p_session_id,p_user_id,p_run_id,p_request_id,p_request_fingerprint,case when p_retry_actor_turn_id is null then 'coach_reply' else 'coach_retry_reply' end,'in_flight',p_lease_token,clock_timestamp()+interval '120 seconds'); return query select p_operation_id,'claimed',r.acting_session_id,p_actor_turn_id,p_actor_text; end $$;

create or replace function public.acttub_complete_coach_turn(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_operation_id uuid,p_lease_token uuid,p_acting_session_id text,p_ai_turn_id uuid,p_question text,p_action text,p_focus_timestamp text,p_done boolean,p_close_reason text,p_response_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$ declare n integer; begin
 perform 1 from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update; if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_interview_runs set acting_session_id=p_acting_session_id,status=case when p_done then 'completed' else 'live' end,close_reason=case when p_done then p_close_reason else null end,ended_at=case when p_done then clock_timestamp() else null end where id=p_run_id and session_id=p_session_id and user_id=p_user_id; update public.practice_turns set delivery_status='completed' where session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and delivery_status='pending' and request_id=(select request_id from public.practice_upstream_operations where id=p_operation_id); select coalesce(max(ordinal),0)+1 into n from public.practice_turns where run_id=p_run_id; insert into public.practice_turns(id,session_id,user_id,run_id,ordinal,role,delivery_status,text,action,focus_timestamp) values(p_ai_turn_id,p_session_id,p_user_id,p_run_id,n,'ai','completed',p_question,p_action,p_focus_timestamp); update public.practice_sessions set status=case when p_done then 'report' else 'interview' end,updated_at=clock_timestamp() where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1';
 update public.practice_upstream_operations set status='completed',response_payload=public.acttub_public_session_payload(p_session_id,p_user_id),finished_at=clock_timestamp() where id=p_operation_id;
end $$;

create or replace function public.acttub_fail_coach_operation(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_operation_id uuid,p_lease_token uuid,p_actor_turn_id uuid,p_failure_class text,p_safe_error_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
 update public.practice_upstream_operations set status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,safe_error_code=p_safe_error_code,
   response_payload=public.acttub_error_replay_payload('coach',p_failure_class,p_safe_error_code,p_run_id),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_turns set delivery_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,delivery_error_code=p_safe_error_code,delivery_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited')) where p_actor_turn_id is not null and id=p_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and request_id=(select request_id from public.practice_upstream_operations where id=p_operation_id);
 update public.practice_interview_runs set status=case when p_failure_class='ambiguous' then 'outcome_unknown' when status='starting' then 'start_failed' else status end,failure_code=p_safe_error_code,failure_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited')),ended_at=case when p_failure_class='ambiguous' or status='starting' then clock_timestamp() else ended_at end where id=p_run_id and session_id=p_session_id and user_id=p_user_id;
end $$;

create or replace function public.acttub_expire_coach_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_operation_id uuid,p_lease_token uuid,p_actor_turn_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_request_id uuid;
begin
 update public.practice_upstream_operations set status='failed',safe_error_code='acting_session_expired',
   response_payload=public.acttub_error_replay_payload('coach','definitive','acting_session_expired',p_run_id),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id
   and kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') and lease_token=p_lease_token and status='in_flight' and lease_expires_at>clock_timestamp()
 returning request_id into v_request_id;
 if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_interview_runs set status='expired',failure_code='acting_session_expired',failure_retryable=false,ended_at=clock_timestamp()
 where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status in ('starting','live');
 if not found then raise exception 'invalid_run'; end if;
 update public.practice_turns set delivery_status='failed',delivery_error_code='acting_session_expired',delivery_retryable=false
 where p_actor_turn_id is not null and id=p_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and request_id=v_request_id;
end $$;

create or replace function public.acttub_claim_report(p_session_id uuid,p_user_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_lease_token uuid,p_lease_seconds integer)
returns table(operation_id uuid,claim_state text,coach_session_payload jsonb) language plpgsql security definer set search_path=public as $$
declare replay record; payload jsonb;
begin
 if p_lease_seconds<>120 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
 if replay.found then return query select replay.operation_id,replay.claim_state,replay.response_payload; return; end if;
 select o.id as operation_id,o.response_payload into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and o.kind='report' and status='outcome_unknown' order by finished_at desc limit 1;
 if found then return query select replay.operation_id,'outcome_unknown',replay.response_payload; return; end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,true);
 select * into replay from public.practice_upstream_operations where session_id=p_session_id and user_id=p_user_id and kind='report' and status='failed' and safe_error_code not in ('acting_api_auth_failed','acting_api_rate_limited') order by finished_at desc limit 1;
 if found then return query select replay.id,'replay_failed',replay.response_payload; return; end if;
 if exists(select 1 from public.practice_upstream_operations where session_id=p_session_id and user_id=p_user_id and kind='report' and status='outcome_unknown') then raise exception 'report_outcome_unknown'; end if;
 select jsonb_build_object('user_id',s.user_id,'session',jsonb_build_object(
   'session_id',r.acting_session_id,'summary',ss.payload,
   'subtext',jsonb_build_object('situation','[매체: '||s.medium||'] [장르: '||s.genre||'] '||s.situation,'character',s.character_context,'subtext',s.subtext),
   'turns',coalesce((select jsonb_agg(jsonb_build_object('role',t.role,'text',t.text) order by t.ordinal) from public.practice_turns t where t.session_id=s.id and t.run_id=r.id and t.user_id=s.user_id and t.delivery_status='completed'),'[]'::jsonb),
   'question_count',(select count(*) from public.practice_turns t where t.session_id=s.id and t.run_id=r.id and t.user_id=s.user_id and t.role='ai' and t.delivery_status='completed'),
   'status','closed','close_reason',coalesce(r.close_reason,''))) into payload
 from public.practice_sessions s join public.scene_summaries ss on (ss.session_id,ss.user_id)=(s.id,s.user_id)
 join public.practice_interview_runs r on (r.session_id,r.id,r.user_id)=(s.id,s.interview_run_id,s.user_id)
 where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='acting-api-v1' and s.status='report' and r.status='completed';
 if payload is null then raise exception 'invalid_session'; end if;
 insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at) values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'report','in_flight',p_lease_token,clock_timestamp()+interval '120 seconds');
 return query select p_operation_id,'claimed',payload;
end $$;

create or replace function public.acttub_complete_report(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_report_id uuid,p_report_payload jsonb,p_report_count integer,p_response_payload jsonb) returns void language plpgsql security definer set search_path=public as $$ begin
 if p_report_count<1 then raise exception 'invalid_report_count'; end if; perform 1 from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and kind='report' and user_id=p_user_id and lease_token=p_lease_token and status='in_flight' and lease_expires_at>clock_timestamp() for update; if not found then raise exception 'upstream_outcome_unknown'; end if;
 insert into public.practice_reports values(p_report_id,p_session_id,p_user_id,p_report_payload,p_report_count,clock_timestamp()); update public.practice_sessions set status='end',updated_at=clock_timestamp() where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1'; update public.practice_upstream_operations set status='completed',response_payload=public.acttub_public_report_payload(p_session_id,p_user_id),finished_at=clock_timestamp() where id=p_operation_id;
end $$;

create or replace function public.acttub_fail_report(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_failure_class text,p_safe_error_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
 update public.practice_upstream_operations set status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,safe_error_code=p_safe_error_code,
   response_payload=public.acttub_error_replay_payload('report',p_failure_class,p_safe_error_code,null),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and kind='report' and user_id=p_user_id and lease_token=p_lease_token and status='in_flight' and lease_expires_at>clock_timestamp();
 if not found then raise exception 'upstream_outcome_unknown'; end if;
end $$;

create or replace function public.acttub_seal_expired_operation(p_session_id uuid,p_user_id uuid,p_operation_id uuid) returns table(sealed boolean,kind text) language plpgsql security definer set search_path=public as $$
declare op public.practice_upstream_operations%rowtype; phase text;
begin
 select * into op from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id for update;
 if not found or op.status<>'in_flight' or op.lease_expires_at>clock_timestamp() then return query select false,null::text; return; end if;
 phase:=case when op.kind like 'analysis_%' then 'analysis' when op.kind='report' then 'report' else 'coach' end;
 update public.practice_upstream_operations set status='outcome_unknown',safe_error_code='acting_api_timeout',
   response_payload=public.acttub_error_replay_payload(phase,'ambiguous','acting_api_timeout',op.run_id),finished_at=clock_timestamp() where id=op.id;
 if op.kind in ('analysis_create','analysis_retry') then
   update public.practice_takes set analysis_status='outcome_unknown',analysis_retryable=false,analysis_error='acting_api_timeout' where session_id=op.session_id and user_id=op.user_id;
 elsif op.kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') then
   update public.practice_interview_runs set status='outcome_unknown',failure_code='acting_api_timeout',failure_retryable=false,ended_at=clock_timestamp() where id=op.run_id and session_id=op.session_id and user_id=op.user_id and status in ('starting','live');
   update public.practice_turns set delivery_status='outcome_unknown',delivery_error_code='acting_api_timeout',delivery_retryable=false where session_id=op.session_id and run_id=op.run_id and user_id=op.user_id and request_id=op.request_id and delivery_status='pending';
 elsif op.kind='report' then
   update public.practice_sessions set status='report',updated_at=clock_timestamp() where id=op.session_id and user_id=op.user_id and pipeline_version='acting-api-v1';
 end if;
 return query select true,op.kind;
end $$;

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
    and s.pipeline_version = 'legacy-gemini-v1'
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



do $$ declare signature regprocedure; begin
  foreach signature in array array[
    'public.acttub_error_replay_payload(text,text,text,uuid)'::regprocedure,
    'public.acttub_public_session_payload(uuid,uuid)'::regprocedure,
    'public.acttub_public_report_payload(uuid,uuid)'::regprocedure,
    'public.acttub_preflight_operation(uuid,uuid,boolean)'::regprocedure,
    'public.acttub_operation_claim_state(uuid,uuid,text)'::regprocedure,
    'public.acttub_finalize_upload_intent(uuid,uuid,text,integer)'::regprocedure,
    'public.acttub_create_acting_session(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,integer,timestamptz)'::regprocedure,
    'public.acttub_claim_analysis_retry(uuid,uuid,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.acttub_complete_analysis(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.acttub_fail_analysis(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.acttub_claim_coach_start(uuid,uuid,uuid,text,uuid,uuid,uuid,integer,boolean)'::regprocedure,
    'public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.acttub_complete_coach_turn(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean,text,jsonb)'::regprocedure,
    'public.acttub_fail_coach_operation(uuid,uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.acttub_expire_coach_run(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure,
    'public.acttub_claim_report(uuid,uuid,uuid,text,uuid,uuid,integer)'::regprocedure,
    'public.acttub_complete_report(uuid,uuid,uuid,uuid,uuid,jsonb,integer,jsonb)'::regprocedure,
    'public.acttub_fail_report(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.acttub_seal_expired_operation(uuid,uuid,uuid)'::regprocedure
  ] loop execute format('revoke execute on function %s from public, anon, authenticated',signature); execute format('grant execute on function %s to service_role',signature); end loop;
end $$;
