-- Forward-only contract hardening for the AI pipeline.
-- This migration tightens source-only invariants without widening the privilege surface.

alter table public.ai_runs add column if not exists request_payload_fingerprint text;
alter table public.ai_runs add column if not exists response_payload jsonb;
do $$ begin alter table public.ai_runs add constraint ai_runs_request_payload_fingerprint_lower_hex check (request_payload_fingerprint is null or request_payload_fingerprint ~ '^[0-9a-f]{64}$'); exception when duplicate_object then null; end $$;

create or replace function public.acttub_confirm_observation(p_session_id uuid,p_user_id uuid,p_observation_id uuid,p_state text,p_correction text default null,p_correction_id uuid default null,p_turn_id uuid default null)
returns setof public.observations language plpgsql security definer set search_path=public as $$ declare seq integer; begin
 perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and deletion_status='active' and (interview_status is null or interview_status in ('active','paused')) for update; if not found then raise exception 'session_not_mutable'; end if;
 if p_state not in ('accepted','rejected','unsure') or (p_correction is not null and (p_state<>'rejected' or length(trim(p_correction))=0)) then raise exception 'invalid_confirmation'; end if;
 if p_state='accepted' and exists(select 1 from public.observations where session_id=p_session_id and user_id=p_user_id and confirmation_state='accepted' and id<>p_observation_id) then raise exception 'accepted_observation_exists'; end if;
 if p_correction is not null then select coalesce(max(sequence)+1,0) into seq from public.interview_turns where session_id=p_session_id;
  insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content) values(p_turn_id,p_session_id,p_user_id,seq,'actor','actor_correction',p_correction);
  insert into public.actor_corrections(id,session_id,user_id,observation_id,content,correction_by_turn_id) values(p_correction_id,p_session_id,p_user_id,p_observation_id,p_correction,p_turn_id);
 end if;
 return query update public.observations set confirmation_state=p_state,blocked_for_questioning=(p_state<>'accepted') where id=p_observation_id and session_id=p_session_id and user_id=p_user_id returning *;
end $$;

drop function if exists public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text);
create or replace function public.acttub_claim_ai_run(p_session_id uuid,p_user_id uuid,p_stage text,p_run_id uuid,p_idempotency_key text,p_max_attempts integer,p_request_schema_version text,p_request_payload_fingerprint text,p_model text,p_prompt_version text)
returns table(id uuid,session_id uuid,user_id uuid,stage text,status text,idempotency_key text,attempt integer,max_attempts integer,request_schema_version text,response_schema_version text,request_payload_fingerprint text,response_payload jsonb,model text,prompt_version text,safe_error_code text,retryable boolean,started_at timestamptz,completed_at timestamptz,updated_at timestamptz,claim_owned boolean)
language plpgsql security definer set search_path=public as $$
declare existing public.ai_runs; session_row public.practice_sessions; total_count integer;
begin
 if p_session_id is null or p_user_id is null or p_run_id is null or p_stage is null or p_idempotency_key is null or p_max_attempts is null or p_request_schema_version is null or p_request_payload_fingerprint is null or p_model is null or p_prompt_version is null or p_stage not in ('summary','agent','report') or p_max_attempts<1 or length(trim(p_idempotency_key))=0 or length(trim(p_request_schema_version))=0 or length(trim(p_model))=0 or length(trim(p_prompt_version))=0 then raise exception 'invalid_claim'; end if;
 if (p_stage='summary' and (p_max_attempts<>2 or p_request_schema_version<>'summary-request.v1' or p_model<>'summary' or p_prompt_version<>'acting-summary.prompt.v2')) or (p_stage='agent' and (p_max_attempts<>2 or p_request_schema_version<>'agent-turn.v1' or p_model<>'agent' or p_prompt_version<>'acting-agent.prompt.v2')) or (p_stage='report' and (p_max_attempts<>2 or p_request_schema_version<>'report-request.v1' or p_model<>'report' or p_prompt_version<>'acting-report.prompt.v2')) then raise exception 'invalid_claim_contract'; end if;
 if p_request_payload_fingerprint is null or p_request_payload_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'request_payload_conflict'; end if;
 select s.* into session_row from public.practice_sessions s
 where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='ai-pipeline.v1'
 and s.required_consent_version_snapshot=public.current_acttub_terms_version()
 and s.ai_processing_consent_version_snapshot=public.current_acttub_ai_processing_consent_version()
 and s.adult_confirmed_at is not null and s.all_participants_confirmed_at is not null
 and exists(select 1 from public.practice_takes t where t.session_id=s.id and t.user_id=p_user_id and t.duration_ms between 1 and 300000 and t.media_metadata_version='iso-bmff-duration.v1')
 and exists(select 1 from public.profiles p where p.id=p_user_id and p.status='active' and p.required_consent_version=public.current_acttub_terms_version() and p.required_consent_at is not null and p.ai_processing_consent_version=public.current_acttub_ai_processing_consent_version() and p.ai_processing_consent_at is not null)
 for update;
 if not found then raise exception 'pipeline_session_not_found'; end if;
 select r.* into existing from public.ai_runs r where r.session_id=p_session_id and r.stage=p_stage and r.idempotency_key=p_idempotency_key for update;
 if found then
  if existing.request_payload_fingerprint is null or existing.request_payload_fingerprint is distinct from p_request_payload_fingerprint or existing.request_schema_version is distinct from p_request_schema_version or existing.max_attempts is distinct from p_max_attempts or existing.prompt_version is distinct from p_prompt_version then raise exception 'request_payload_conflict'; end if;
  if existing.status='running' and p_stage='report' and existing.updated_at < now()-interval '15 minutes' then
   update public.ai_runs r set status='failed',safe_error_code='REPORT_LEASE_EXPIRED',retryable=true,completed_at=now(),updated_at=now() where r.id=existing.id and r.status='running';
   existing.status:='failed'; existing.safe_error_code:='REPORT_LEASE_EXPIRED'; existing.retryable:=true;
  elsif existing.status in ('completed','pending','running') then
   return query select existing.id,existing.session_id,existing.user_id,existing.stage,existing.status,existing.idempotency_key,existing.attempt,existing.max_attempts,existing.request_schema_version,existing.response_schema_version,existing.request_payload_fingerprint,existing.response_payload,existing.model,existing.prompt_version,existing.safe_error_code,existing.retryable,existing.started_at,existing.completed_at,existing.updated_at,false; return;
  end if;
  if existing.status<>'failed' or not existing.retryable or existing.attempt>=existing.max_attempts or p_run_id=existing.id then raise exception 'run_not_retryable'; end if;
  if session_row.deletion_status<>'active' then raise exception 'pipeline_session_not_found'; end if;
  select count(*) into total_count from public.interview_turns t where t.session_id=p_session_id and t.user_id=p_user_id and t.role='actor' and t.kind in ('answer','unknown');
  if p_stage='summary' and not (session_row.interview_status='active' and session_row.substantive_answer_count=0 and not exists(select 1 from public.ai_session_summaries s where s.session_id=p_session_id and s.user_id=p_user_id) and total_count=0) then raise exception 'pipeline_session_not_found'; end if;
  if p_stage='agent' and not (session_row.interview_status in ('active','paused') and exists(select 1 from public.ai_session_summaries s where s.session_id=p_session_id and s.user_id=p_user_id) and total_count<10) then raise exception 'pipeline_session_not_found'; end if;
  if p_stage='report' and not (session_row.interview_status='completed' and session_row.completion_reason in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready') and not exists(select 1 from public.ai_reports r where r.session_id=p_session_id and r.user_id=p_user_id)) then raise exception 'pipeline_session_not_found'; end if;
  return query update public.ai_runs r set id=p_run_id,status='running',attempt=r.attempt+1,safe_error_code=null,retryable=false,started_at=now(),completed_at=null,updated_at=now(),request_payload_fingerprint=p_request_payload_fingerprint,response_payload=null where r.id=existing.id
   returning r.id,r.session_id,r.user_id,r.stage,r.status,r.idempotency_key,r.attempt,r.max_attempts,r.request_schema_version,r.response_schema_version,r.request_payload_fingerprint,r.response_payload,r.model,r.prompt_version,r.safe_error_code,r.retryable,r.started_at,r.completed_at,r.updated_at,true; return;
 end if;
 if session_row.deletion_status<>'active' then raise exception 'pipeline_session_not_found'; end if;
 select count(*) into total_count from public.interview_turns t where t.session_id=p_session_id and t.user_id=p_user_id and t.role='actor' and t.kind in ('answer','unknown');
 if p_stage='summary' and not (session_row.interview_status='active' and session_row.substantive_answer_count=0 and not exists(select 1 from public.ai_session_summaries s where s.session_id=p_session_id and s.user_id=p_user_id) and total_count=0) then raise exception 'pipeline_session_not_found'; end if;
 if p_stage='agent' and not (session_row.interview_status in ('active','paused') and exists(select 1 from public.ai_session_summaries s where s.session_id=p_session_id and s.user_id=p_user_id) and total_count<10) then raise exception 'pipeline_session_not_found'; end if;
 if p_stage='report' and not (session_row.interview_status='completed' and session_row.completion_reason in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready') and not exists(select 1 from public.ai_reports r where r.session_id=p_session_id and r.user_id=p_user_id)) then raise exception 'pipeline_session_not_found'; end if;
 return query insert into public.ai_runs as r(id,session_id,user_id,stage,status,idempotency_key,attempt,max_attempts,request_schema_version,request_payload_fingerprint,response_payload,model,prompt_version,started_at) values(p_run_id,p_session_id,p_user_id,p_stage,'running',p_idempotency_key,1,p_max_attempts,p_request_schema_version,p_request_payload_fingerprint,null,p_model,p_prompt_version,now())
 returning r.id,r.session_id,r.user_id,r.stage,r.status,r.idempotency_key,r.attempt,r.max_attempts,r.request_schema_version,r.response_schema_version,r.request_payload_fingerprint,r.response_payload,r.model,r.prompt_version,r.safe_error_code,r.retryable,r.started_at,r.completed_at,r.updated_at,true;
end $$;

create or replace function public.acttub_complete_summary_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_summary jsonb,p_candidates jsonb,p_model text,p_prompt_version text)
returns jsonb language plpgsql security definer set search_path=public as $$ declare c jsonb; a jsonb; take uuid; duration integer; existing_run uuid; idx integer; expected_start integer; expected_end integer; begin
 select source_run_id into existing_run from public.ai_session_summaries where session_id=p_session_id and user_id=p_user_id for update; if found and existing_run is distinct from p_run_id then raise exception 'summary_run_conflict'; end if; if found then return (select jsonb_build_object('sessionId',s.session_id,'sourceRunId',s.source_run_id,'normalizedSummary',s.normalized_summary,'observationCandidates',coalesce(jsonb_agg(jsonb_build_object('id',o.candidate_id,'startMs',o.timestamp_start_ms,'endMs',o.timestamp_end_ms,'text',o.observation_text,'priority',o.priority,'dimension',o.dimension,'severity',o.severity) order by o.priority) filter(where o.id is not null),'[]'::jsonb)) from public.ai_session_summaries s left join public.observations o on o.session_id=s.session_id and o.source_run_id=s.source_run_id where s.session_id=p_session_id and s.user_id=p_user_id group by s.session_id,s.source_run_id,s.normalized_summary); end if;
 perform 1 from public.ai_runs r join public.practice_sessions s on s.id=r.session_id and s.user_id=r.user_id where r.id=p_run_id and r.session_id=p_session_id and r.user_id=p_user_id and r.stage='summary' and r.status='running' and s.required_consent_version_snapshot=public.current_acttub_terms_version() and s.ai_processing_consent_version_snapshot=public.current_acttub_ai_processing_consent_version() and exists(select 1 from public.profiles p where p.id=p_user_id and p.status='active' and p.required_consent_version=public.current_acttub_terms_version() and p.required_consent_at is not null and p.ai_processing_consent_version=public.current_acttub_ai_processing_consent_version() and p.ai_processing_consent_at is not null) and length(trim(p_model))>0 and p_prompt_version='acting-summary.prompt.v2' for update; if not found then raise exception 'run_not_running'; end if;
 if jsonb_typeof(p_summary) is distinct from 'object' or jsonb_typeof(p_candidates) is distinct from 'array' then raise exception 'invalid_summary'; end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_summary) k) is distinct from array['anomalies','intentAlignment','keyDimension','keyMoment','observation','schemaVersion','subtextStatus','summary'] or jsonb_typeof(p_summary->'schemaVersion') is distinct from 'string' or p_summary->>'schemaVersion' is distinct from 'scene-summary.v1' or jsonb_typeof(p_summary->'subtextStatus') is distinct from 'string' or p_summary->>'subtextStatus' not in ('provided','not_provided') or jsonb_typeof(p_summary->'summary') is distinct from 'string' or jsonb_typeof(p_summary->'observation') is distinct from 'object' or jsonb_typeof(p_summary->'anomalies') is distinct from 'array' or jsonb_array_length(p_candidates)<>jsonb_array_length(p_summary->'anomalies') or length(trim(p_summary->>'summary'))=0 then raise exception 'invalid_summary'; end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_summary->'observation') k)<>array['dialogue','emotion','expression','extra','movement','pitch','tempo','timeline'] or jsonb_typeof(p_summary->'observation'->'extra')<>'array' or exists(select 1 from jsonb_each(p_summary->'observation') e where e.key<>'extra' and (jsonb_typeof(e.value)<>'string' or length(trim(e.value#>>'{}'))=0)) or exists(select 1 from jsonb_array_elements(p_summary->'observation'->'extra') x where jsonb_typeof(x)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(x) k)<>array['name','observation'] or jsonb_typeof(x->'name')<>'string' or length(trim(x->>'name'))=0 or jsonb_typeof(x->'observation')<>'string' or length(trim(x->>'observation'))=0) then raise exception 'invalid_summary_observation'; end if;
 if exists(select 1 from (values(p_summary->'intentAlignment'),(p_summary->'keyMoment'),(p_summary->'keyDimension')) v(x) where jsonb_typeof(x) not in ('null','string') or (jsonb_typeof(x)='string' and length(trim(x#>>'{}'))=0)) or (p_summary->>'subtextStatus'='not_provided' and (p_summary->'intentAlignment'<>'null'::jsonb or p_summary->'keyMoment'<>'null'::jsonb or p_summary->'keyDimension'<>'null'::jsonb)) then raise exception 'invalid_summary_nullable'; end if;
 if (p_summary->>'subtextStatus')<>(select case when nullif(trim(subtext),'') is null then 'not_provided' else 'provided' end from public.practice_sessions where id=p_session_id and user_id=p_user_id) then raise exception 'summary_subtext_mismatch'; end if;
 select id,duration_ms into take,duration from public.practice_takes where session_id=p_session_id and user_id=p_user_id order by created_at limit 1; if take is null then raise exception 'take_not_found'; end if;
 insert into public.ai_session_summaries(session_id,user_id,take_id,schema_version,subtext_status,normalized_summary,source_run_id) values(p_session_id,p_user_id,take,'scene-summary.v1',p_summary->>'subtextStatus',p_summary,p_run_id);
 for c,idx in select value,ordinality::integer from jsonb_array_elements(p_candidates) with ordinality loop a:=p_summary->'anomalies'->(idx-1); if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'id') is distinct from 'string' or c->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or jsonb_typeof(c->'priority') is distinct from 'number' or c->>'priority' !~ '^(0|[1-9]|10)$' or jsonb_typeof(c->'startMs') is distinct from 'number' or c->>'startMs' !~ '^(0|[1-9][0-9]{0,5})$' or jsonb_typeof(c->'endMs') is distinct from 'number' or c->>'endMs' !~ '^(0|[1-9][0-9]{0,5})$' or jsonb_typeof(c->'text') is distinct from 'string' or length(trim(c->>'text'))=0 or jsonb_typeof(c->'dimension') is distinct from 'string' or length(trim(c->>'dimension'))=0 or jsonb_typeof(c->'severity') not in ('null','string') or (jsonb_typeof(c->'severity')='string' and c->>'severity' not in ('high','mid','low')) or jsonb_typeof(a->'start') is distinct from 'string' or jsonb_typeof(a->'end') is distinct from 'string' then raise exception 'invalid_summary_candidate'; end if; if (select array_agg(k order by k) from jsonb_object_keys(a) k)<>array['dimension','end','impactOnIntent','intentImpact','likelyCause','onKeyDimension','overlapsKeyMoment','severity','severityReason','start','what','whyOdd'] or (a->>'start')!~'^[0-9]{2,}:[0-5][0-9]$' or (a->>'end')!~'^[0-9]{2,}:[0-5][0-9]$' or jsonb_typeof(a->'dimension')<>'string' or length(trim(a->>'dimension'))=0 or jsonb_typeof(a->'what')<>'string' or length(trim(a->>'what'))=0 or exists(select 1 from (values(a->'whyOdd'),(a->'likelyCause'),(a->'impactOnIntent'),(a->'severityReason')) v(x) where jsonb_typeof(x) not in ('null','string') or (jsonb_typeof(x)='string' and length(trim(x#>>'{}'))=0)) or jsonb_typeof(a->'overlapsKeyMoment') not in ('null','boolean') or jsonb_typeof(a->'onKeyDimension') not in ('null','boolean') or (a->'intentImpact'<>'null'::jsonb and a->>'intentImpact' not in ('반전','약화','국소')) or (a->'severity'<>'null'::jsonb and a->>'severity' not in ('high','mid','low')) or (p_summary->>'subtextStatus'='not_provided' and exists(select 1 from (values(a->'whyOdd'),(a->'likelyCause'),(a->'impactOnIntent'),(a->'overlapsKeyMoment'),(a->'onKeyDimension'),(a->'intentImpact'),(a->'severity'),(a->'severityReason')) v(x) where x<>'null'::jsonb)) then raise exception 'invalid_summary_anomaly'; end if; expected_start:=((split_part(a->>'start',':',1)::integer*60)+split_part(a->>'start',':',2)::integer)*1000; expected_end:=((split_part(a->>'end',':',1)::integer*60)+split_part(a->>'end',':',2)::integer)*1000; if expected_start>expected_end then raise exception 'invalid_summary_anomaly_range'; end if; expected_start:=least(expected_start,duration); expected_end:=least(expected_end,duration); if (select array_agg(k order by k) from jsonb_object_keys(c) k)<>array['dimension','endMs','id','priority','severity','startMs','text'] or (c->>'priority')::integer<>idx or c->>'text'<>a->>'what' or c->>'dimension'<>a->>'dimension' or c->'severity' is distinct from a->'severity' or (c->>'startMs')::integer<>expected_start or (c->>'endMs')::integer<>expected_end then raise exception 'invalid_summary_candidate'; end if;
  insert into public.observations(id,session_id,take_id,user_id,timestamp_start_ms,timestamp_end_ms,observation_text,confidence,confirmation_state,blocked_for_questioning,candidate_id,priority,dimension,severity,source_run_id) values((c->>'id')::uuid,p_session_id,take,p_user_id,(c->>'startMs')::integer,(c->>'endMs')::integer,c->>'text',null,'unasked',false,(c->>'id')::uuid,idx,c->>'dimension',c->>'severity',p_run_id);
 end loop;
 update public.ai_runs set status='completed',response_schema_version='summary-response.v1',model=p_model,prompt_version=p_prompt_version,safe_error_code=null,completed_at=now(),updated_at=now(),response_payload=jsonb_build_object('schemaVersion','summary-response.v1','sessionId',p_session_id,'runId',p_run_id,'normalizedSummary',p_summary,'observationCandidates',coalesce((select jsonb_agg(jsonb_build_object('candidateId',x->>'id','timestampStartMs',(x->>'startMs')::integer,'timestampEndMs',(x->>'endMs')::integer,'observationText',x->>'text','confidence',null,'priority',(x->>'priority')::integer,'dimension',x->>'dimension','severity',x->'severity')) from jsonb_array_elements(p_candidates) x),'[]'::jsonb),'model',p_model,'promptVersion',p_prompt_version) where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='running';
 return jsonb_build_object('session_id',p_session_id,'run_id',p_run_id);
end $$;

create or replace function public.acttub_append_pipeline_turn(p_session_id uuid,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 expected integer;
 actor jsonb;
 agent jsonb;
 conversation_count integer;
 completion_status_value text := nullif(trim(p_payload->>'completionStatus'), '');
 completion_reason_value text := nullif(trim(p_payload->>'completionReason'), '');
 obs uuid[] := array(select jsonb_array_elements_text(p_payload->'reportEvidence'->'observationIds'))::uuid[];
 turns uuid[] := array(select jsonb_array_elements_text(p_payload->'reportEvidence'->'answerTurnIds'))::uuid[];
 last_two_kinds text[];
begin
 if (completion_status_value is null)<>(completion_reason_value is null) or (completion_status_value is not null and completion_status_value not in ('completed','paused','completed_without_report')) then raise exception 'invalid_completion'; end if;
 if jsonb_typeof(p_payload->'expectedSubstantiveAnswerCount') is distinct from 'number' or (p_payload->>'expectedSubstantiveAnswerCount') !~ '^(0|[1-9]|10)$' or jsonb_typeof(p_payload->'expectedTotalConversationCount') is distinct from 'number' or (p_payload->>'expectedTotalConversationCount') !~ '^(0|[1-9]|10)$' or (p_payload->>'expectedSubstantiveAnswerCount')::integer>(p_payload->>'expectedTotalConversationCount')::integer then raise exception 'turn_conflict'; end if;
 select substantive_answer_count into expected
 from public.practice_sessions s
 where s.id=p_session_id
   and s.user_id=p_user_id
   and s.interview_status in ('active','paused')
   and s.deletion_status='active'
   and s.required_consent_version_snapshot=public.current_acttub_terms_version()
   and s.ai_processing_consent_version_snapshot=public.current_acttub_ai_processing_consent_version()
   and exists(select 1 from public.profiles p where p.id=p_user_id and p.status='active' and p.required_consent_version=public.current_acttub_terms_version() and p.required_consent_at is not null and p.ai_processing_consent_version=public.current_acttub_ai_processing_consent_version() and p.ai_processing_consent_at is not null)
 for update;
 if not found or expected is distinct from (p_payload->>'expectedSubstantiveAnswerCount')::integer or expected>=10 then raise exception 'turn_conflict'; end if;
 select count(*) into conversation_count from public.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in ('answer','unknown');
 if conversation_count>=10 then raise exception 'turn_conflict'; end if;
 if conversation_count is distinct from (p_payload->>'expectedTotalConversationCount')::integer then raise exception 'turn_conflict'; end if;
 actor:=p_payload->'actorTurn';
 agent:=p_payload->'agentTurn';
 if p_payload->'currentInput'->>'command' not in ('start','observation_update','answer','manual_stop','resume') or ((p_payload->'currentInput'->>'command') in ('start','observation_update','manual_stop','resume') and actor<>'null'::jsonb) or ((p_payload->'currentInput'->>'command')='resume' and not exists(select 1 from public.practice_sessions where id=p_session_id and interview_status='paused')) then raise exception 'invalid_current_input'; end if;
 if jsonb_array_length(p_payload->'reportEvidence'->'observationIds')<>(select count(distinct x) from jsonb_array_elements_text(p_payload->'reportEvidence'->'observationIds') x) or jsonb_array_length(p_payload->'reportEvidence'->'answerTurnIds')<>(select count(distinct x) from jsonb_array_elements_text(p_payload->'reportEvidence'->'answerTurnIds') x) or exists(select 1 from jsonb_array_elements_text(p_payload->'reportEvidence'->'observationIds') x where not exists(select 1 from public.observations o where o.id=x::uuid and o.session_id=p_session_id and o.user_id=p_user_id and o.confirmation_state='accepted' and not o.blocked_for_questioning)) or exists(select 1 from jsonb_array_elements_text(p_payload->'reportEvidence'->'answerTurnIds') x where not exists(select 1 from public.interview_turns t where t.id=x::uuid and t.session_id=p_session_id and t.user_id=p_user_id and t.role='actor' and t.kind='answer' and t.report_evidence_selected) and not (actor is not null and actor<>'null'::jsonb and actor->>'id'=x and actor->>'kind'='answer' and coalesce((actor->>'reportEvidenceSelected')::boolean,false))) then raise exception 'invalid_report_evidence'; end if;
 if (p_payload->'currentInput'->>'command')='answer' and (actor is null or actor='null'::jsonb or actor->>'kind' not in ('answer','unknown') or p_payload->'currentInput'->>'answerTurnId'<>actor->>'id' or p_payload->'currentInput'->>'answer'<>actor->>'content') then raise exception 'current_input_mismatch'; end if;
 if actor is not null and actor<>'null'::jsonb then
  if actor->>'kind' not in ('answer','unknown') or (actor->>'sequence')::integer<>(select coalesce(max(sequence)+1,0) from public.interview_turns where session_id=p_session_id) then raise exception 'invalid_actor_turn'; end if;
  insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content,source_observation_ids,report_evidence_selected)
   values((actor->>'id')::uuid,p_session_id,p_user_id,(actor->>'sequence')::integer,'actor',actor->>'kind',actor->>'content',array(select jsonb_array_elements_text(actor->'sourceObservationIds'))::uuid[],coalesce((actor->>'reportEvidenceSelected')::boolean,false));
  if actor->>'kind'='answer' then expected:=expected+1; end if;
  if actor->>'kind' in ('answer','unknown') and conversation_count=9 and (completion_status_value is null or completion_status_value='paused') then raise exception 'turn_conflict'; end if;
 end if;
 if (agent->>'sequence')::integer<>(select coalesce(max(sequence)+1,0) from public.interview_turns where session_id=p_session_id) or agent->>'kind' not in ('question','closing') then raise exception 'invalid_agent_turn'; end if;
 if exists(select 1 from jsonb_array_elements_text(agent->'sourceObservationIds') x where not exists(select 1 from public.observations o where o.id=x::uuid and o.session_id=p_session_id and o.user_id=p_user_id and o.confirmation_state='accepted' and not o.blocked_for_questioning)) then raise exception 'invalid_source_observation'; end if;
 insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content,question_focus,source_observation_ids)
  values((agent->>'id')::uuid,p_session_id,p_user_id,(agent->>'sequence')::integer,'agent',agent->>'kind',agent->>'content',agent->>'questionFocus',array(select jsonb_array_elements_text(agent->'sourceObservationIds'))::uuid[]);
 update public.practice_sessions set substantive_answer_count=expected,interview_status='active',report_evidence_observation_ids=array(select jsonb_array_elements_text(p_payload->'reportEvidence'->'observationIds'))::uuid[],report_evidence_answer_turn_ids=array(select jsonb_array_elements_text(p_payload->'reportEvidence'->'answerTurnIds'))::uuid[],updated_at=now() where id=p_session_id;
 update public.ai_runs set status='completed',response_schema_version='agent-turn.v1',model=trim(p_payload->>'model'),prompt_version=p_payload->>'promptVersion',completed_at=now(),updated_at=now(),response_payload=jsonb_build_object('actorTurn',p_payload->'actorTurn','agentTurn',p_payload->'agentTurn','done',(completion_status_value is not null and completion_status_value<>'paused'),'completionReason',completion_reason_value,'reportReady',coalesce(completion_status_value='completed',false),'reportEvidence',p_payload->'reportEvidence') where id=(p_payload->>'agentRunId')::uuid and session_id=p_session_id and user_id=p_user_id and stage='agent' and status='running' and length(trim(p_payload->>'model'))>0 and p_payload->>'promptVersion'='acting-agent.prompt.v2';
 if not found then raise exception 'agent_run_not_running'; end if;
	 if completion_status_value is not null then
	  select array_agg(kind order by sequence desc) into last_two_kinds
	  from (select kind,sequence from public.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in ('answer','unknown') order by sequence desc limit 2) counted;
	  select count(*) into conversation_count from public.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in ('answer','unknown');
	  if conversation_count=10 and not ((completion_status_value='completed' and completion_reason_value='hard_limit_report_ready') or (completion_status_value='completed_without_report' and completion_reason_value='insufficient_interview_evidence')) then raise exception 'invalid_tenth_completion'; end if;
  if (completion_status_value='completed' and completion_reason_value not in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready')) or (completion_status_value='paused' and completion_reason_value<>'manual_stop_paused') or (completion_status_value='completed_without_report' and completion_reason_value not in ('insufficient_confirmed_evidence','insufficient_interview_evidence')) then raise exception 'invalid_completion'; end if;
  if completion_reason_value='interview_complete_report_ready' and expected<5 and not (coalesce(array_length(last_two_kinds,1),0)=2 and last_two_kinds[1]='unknown' and last_two_kinds[2]='unknown') then raise exception 'invalid_completion_count'; end if;
  if completion_reason_value='hard_limit_report_ready' and conversation_count<>10 then raise exception 'invalid_completion_count'; end if;
  if completion_reason_value='insufficient_interview_evidence' and conversation_count<>10 and expected<5 and not (coalesce(array_length(last_two_kinds,1),0)=2 and last_two_kinds[1]='unknown' and last_two_kinds[2]='unknown') then raise exception 'invalid_completion_count'; end if;
  if completion_status_value='completed' then
   if cardinality(obs)=0 or cardinality(turns)=0 or exists(select 1 from unnest(obs) x where not exists(select 1 from public.observations o where o.id=x and o.session_id=p_session_id and o.user_id=p_user_id and o.confirmation_state='accepted' and not o.blocked_for_questioning)) or exists(select 1 from unnest(turns) x where not exists(select 1 from public.interview_turns t where t.id=x and t.session_id=p_session_id and t.user_id=p_user_id and t.role='actor' and t.kind='answer' and length(trim(t.content))>0 and t.report_evidence_selected)) then raise exception 'invalid_report_evidence'; end if;
  else
   if cardinality(obs)<>0 or cardinality(turns)<>0 then raise exception 'evidence_not_allowed'; end if;
  end if;
  update public.practice_sessions set interview_status=completion_status_value,completion_reason=completion_reason_value,report_evidence_observation_ids=obs,report_evidence_answer_turn_ids=turns,updated_at=now() where id=p_session_id;
 end if;
 return jsonb_build_object('substantive_answer_count',expected);
end $$;

create or replace function public.acttub_complete_interview(p_session_id uuid,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ declare reason text:=p_payload->>'completionReason'; stat text:=p_payload->>'status'; obs uuid[]:=array(select jsonb_array_elements_text(p_payload->'observationIds'))::uuid[]; turns uuid[]:=array(select jsonb_array_elements_text(p_payload->'answerTurnIds'))::uuid[]; n integer; conversation_count integer; next_sequence integer; last_two_kinds text[]; agent_run_id text:=p_payload->>'agentRunId'; agent_response jsonb:=p_payload->'agentResponse'; agent_turn jsonb:=p_payload->'agentResponse'->'agentTurn'; begin
 if stat is null or reason is null or stat not in ('completed','paused','completed_without_report') then raise exception 'invalid_completion'; end if;
 select substantive_answer_count into n from public.practice_sessions where id=p_session_id and user_id=p_user_id and deletion_status='active' and interview_status in ('active','paused') for update; if not found then raise exception 'session_not_mutable'; end if;
 select count(*) into conversation_count from public.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in ('answer','unknown');
 select array_agg(kind order by sequence desc) into last_two_kinds from (select kind,sequence from public.interview_turns where session_id=p_session_id and user_id=p_user_id and role='actor' and kind in ('answer','unknown') order by sequence desc limit 2) counted;
 if conversation_count=10 and not ((stat='completed' and reason='hard_limit_report_ready') or (stat='completed_without_report' and reason='insufficient_interview_evidence')) then raise exception 'invalid_tenth_completion'; end if;
 if (stat='completed' and reason not in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready')) or (stat='paused' and reason<>'manual_stop_paused') or (stat='completed_without_report' and reason not in ('insufficient_confirmed_evidence','insufficient_interview_evidence')) then raise exception 'invalid_completion'; end if;
 if reason='interview_complete_report_ready' and n<5 and not (coalesce(array_length(last_two_kinds,1),0)=2 and last_two_kinds[1]='unknown' and last_two_kinds[2]='unknown') then raise exception 'invalid_completion_count'; end if;
 if reason='hard_limit_report_ready' and conversation_count<>10 then raise exception 'invalid_completion_count'; end if;
 if reason='insufficient_interview_evidence' and conversation_count<>10 and n<5 and not (coalesce(array_length(last_two_kinds,1),0)=2 and last_two_kinds[1]='unknown' and last_two_kinds[2]='unknown') then raise exception 'invalid_completion_count'; end if;
 if cardinality(obs)<>cardinality(array(select distinct x from unnest(obs) x)) or cardinality(turns)<>cardinality(array(select distinct x from unnest(turns) x)) then raise exception 'duplicate_report_evidence'; end if;
 if stat='completed' then if cardinality(obs)=0 or cardinality(turns)=0 or exists(select 1 from unnest(obs) x where not exists(select 1 from public.observations o where o.id=x and o.session_id=p_session_id and o.user_id=p_user_id and o.confirmation_state='accepted' and not o.blocked_for_questioning)) or exists(select 1 from unnest(turns) x where not exists(select 1 from public.interview_turns t where t.id=x and t.session_id=p_session_id and t.user_id=p_user_id and t.role='actor' and t.kind='answer' and length(trim(t.content))>0 and t.report_evidence_selected)) then raise exception 'invalid_report_evidence'; end if; else if cardinality(obs)<>0 or cardinality(turns)<>0 then raise exception 'evidence_not_allowed'; end if; end if;
 update public.practice_sessions set interview_status=stat,completion_reason=reason,report_evidence_observation_ids=obs,report_evidence_answer_turn_ids=turns,updated_at=now() where id=p_session_id;
 if (agent_run_id is null and (p_payload ? 'agentResponse' or p_payload ? 'model' or p_payload ? 'promptVersion')) or (agent_run_id is not null and (length(trim(agent_run_id))=0 or not (p_payload ? 'agentResponse' and p_payload ? 'model' and p_payload ? 'promptVersion'))) then raise exception 'invalid_agent_completion_contract'; end if;
 if agent_run_id is not null then
  if agent_run_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'invalid_agent_completion_contract'; end if;
  select coalesce(max(sequence)+1,0) into next_sequence from public.interview_turns where session_id=p_session_id and user_id=p_user_id;
  if agent_response is null or jsonb_typeof(agent_response)<>'object' or agent_turn is null or jsonb_typeof(agent_turn)<>'object' then raise exception 'invalid_agent_completion_payload'; end if;
  if agent_turn->'id' is null or jsonb_typeof(agent_turn->'id')<>'string' or agent_turn->'sequence' is null or jsonb_typeof(agent_turn->'sequence')<>'number' or agent_turn->'content' is null or jsonb_typeof(agent_turn->'content')<>'string' or agent_turn->'role' is null or jsonb_typeof(agent_turn->'role')<>'string' or agent_turn->'kind' is null or jsonb_typeof(agent_turn->'kind')<>'string' or agent_turn->'sourceObservationIds' is null or jsonb_typeof(agent_turn->'sourceObservationIds')<>'array' or agent_turn->'reportEvidenceSelected' is null or jsonb_typeof(agent_turn->'reportEvidenceSelected')<>'boolean' then raise exception 'invalid_agent_completion_payload'; end if;
  if agent_response is null or jsonb_typeof(agent_response)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(agent_response) k)<>array['actorTurn','agentTurn','completionReason','done','reportEvidence','reportReady'] or agent_response->'actorTurn'<>'null'::jsonb or jsonb_typeof(agent_turn)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(agent_turn) k)<>array['content','groundingEndMs','groundingStartMs','id','kind','questionFocus','reportEvidenceSelected','role','sequence','sourceObservationIds'] or agent_turn->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or (agent_turn->>'sequence')::integer<>next_sequence or agent_turn->>'role'<>'agent' or length(trim(coalesce(agent_turn->>'content','')))=0 or agent_turn->'groundingStartMs'<>'null'::jsonb or agent_turn->'groundingEndMs'<>'null'::jsonb or jsonb_typeof(agent_turn->'sequence')<>'number' or (agent_turn->>'sequence')::numeric<>trunc((agent_turn->>'sequence')::numeric) or (agent_turn->>'sequence')::numeric<0 or jsonb_typeof(agent_turn->'sourceObservationIds')<>'array' or jsonb_typeof(agent_turn->'reportEvidenceSelected')<>'boolean' or agent_turn->>'reportEvidenceSelected'<>'false' or (agent_turn->'questionFocus'<>'null'::jsonb and (jsonb_typeof(agent_turn->'questionFocus')<>'string' or length(trim(agent_turn->>'questionFocus'))=0)) or jsonb_typeof(agent_response->'done')<>'boolean' or (agent_response->>'done')::boolean is distinct from (stat<>'paused') or agent_response->>'completionReason' is distinct from reason or jsonb_typeof(agent_response->'reportReady')<>'boolean' or (agent_response->>'reportReady')::boolean is distinct from (stat='completed') or agent_response->'reportEvidence' is distinct from jsonb_build_object('observationIds',to_jsonb(obs),'answerTurnIds',to_jsonb(turns)) or (stat='paused' and agent_turn->>'kind'<>'question') or (stat<>'paused' and agent_turn->>'kind'<>'closing') then raise exception 'invalid_agent_completion_payload'; end if;
  if jsonb_array_length(agent_turn->'sourceObservationIds')<>cardinality(array(select distinct x from jsonb_array_elements_text(agent_turn->'sourceObservationIds') x)) or exists(select 1 from jsonb_array_elements_text(agent_turn->'sourceObservationIds') x where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or not exists(select 1 from public.observations o where o.id=x::uuid and o.session_id=p_session_id and o.user_id=p_user_id and o.confirmation_state='accepted' and not o.blocked_for_questioning)) then raise exception 'invalid_agent_completion_payload'; end if;
  if length(trim(coalesce(p_payload->>'model','')))=0 or p_payload->>'promptVersion'<>'acting-agent.prompt.v2' then raise exception 'invalid_agent_completion_contract'; end if;
  perform 1 from public.ai_runs where id=agent_run_id::uuid and session_id=p_session_id and user_id=p_user_id and stage='agent' and status='running' and request_schema_version='agent-turn.v1' and prompt_version='acting-agent.prompt.v2' for update; if not found then raise exception 'agent_run_not_running'; end if;
  insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content,question_focus,grounding_start_ms,grounding_end_ms,source_observation_ids,report_evidence_selected) values((agent_turn->>'id')::uuid,p_session_id,p_user_id,next_sequence,'agent',agent_turn->>'kind',agent_turn->>'content',case when agent_turn->'questionFocus'='null'::jsonb then null else agent_turn->>'questionFocus' end,null,null,array(select jsonb_array_elements_text(agent_turn->'sourceObservationIds'))::uuid[],false);
  update public.ai_runs set status='completed',response_schema_version='agent-turn.v1',response_payload=p_payload->'agentResponse',model=trim(p_payload->>'model'),prompt_version=p_payload->>'promptVersion',completed_at=now(),updated_at=now() where id=agent_run_id::uuid and session_id=p_session_id and user_id=p_user_id and stage='agent' and status='running'; if not found then raise exception 'agent_run_not_running'; end if;
 end if;
 return jsonb_build_object('status',stat,'completion_reason',reason);
end $$;

create or replace function public.acttub_complete_report_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_report jsonb,p_model text,p_prompt_version text)
returns jsonb language plpgsql security definer set search_path=public as $$ declare sec jsonb:=p_report->'sections'; existing public.ai_reports; e record; range jsonb; begin
 select * into existing from public.ai_reports where session_id=p_session_id and user_id=p_user_id for update; if found and existing.source_run_id is distinct from p_run_id then raise exception 'report_run_conflict'; end if; if found then return jsonb_build_object('schemaVersion',existing.schema_version,'sections',jsonb_build_object('oneLineSummary',existing.one_line_summary,'primaryReviewPoint',existing.primary_review_point,'confirmedEvidence',existing.confirmed_evidence,'actorDiscovery',existing.actor_discovery,'groundedEncouragement',existing.grounded_encouragement,'nextPracticeStep',existing.next_practice_step)); end if;
 perform 1 from public.ai_runs r join public.practice_sessions s on s.id=r.session_id and s.user_id=r.user_id where r.id=p_run_id and r.session_id=p_session_id and r.user_id=p_user_id and r.stage='report' and r.status='running' and s.interview_status='completed' and s.completion_reason in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready') and s.required_consent_version_snapshot=public.current_acttub_terms_version() and s.ai_processing_consent_version_snapshot=public.current_acttub_ai_processing_consent_version() and exists(select 1 from public.profiles p where p.id=p_user_id and p.status='active' and p.required_consent_version=public.current_acttub_terms_version() and p.required_consent_at is not null and p.ai_processing_consent_version=public.current_acttub_ai_processing_consent_version() and p.ai_processing_consent_at is not null) and length(trim(p_model))>0 and p_prompt_version='acting-report.prompt.v2' for update; if not found then raise exception 'report_not_ready'; end if;
 perform 1 from public.ai_session_summaries sm where sm.session_id=p_session_id and sm.user_id=p_user_id and not exists(select 1 from public.observations o where o.session_id=p_session_id and o.user_id=p_user_id and o.id=any((select report_evidence_observation_ids from public.practice_sessions where id=p_session_id)) and o.source_run_id is distinct from sm.source_run_id); if not found then raise exception 'summary_lineage_conflict'; end if;
 if exists(select 1 from public.actor_corrections c join public.observations o on o.id=c.observation_id and o.session_id=c.session_id and o.user_id=c.user_id join public.interview_turns t on t.id=c.correction_by_turn_id and t.session_id=c.session_id and t.user_id=c.user_id join public.ai_session_summaries sm on sm.session_id=c.session_id and sm.user_id=c.user_id where c.session_id=p_session_id and c.user_id=p_user_id and (o.confirmation_state<>'rejected' or not o.blocked_for_questioning or o.source_run_id is distinct from sm.source_run_id or t.role<>'actor' or t.kind<>'actor_correction' or t.content is distinct from c.content)) then raise exception 'correction_lineage_conflict'; end if;
 if jsonb_typeof(p_report) is distinct from 'object' or jsonb_typeof(sec) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_report) k) is distinct from array['schemaVersion','sections'] or jsonb_typeof(p_report->'schemaVersion') is distinct from 'string' or p_report->>'schemaVersion' is distinct from 'report.v1' or (select array_agg(k order by k) from jsonb_object_keys(sec) k) is distinct from array['actorDiscovery','confirmedEvidence','groundedEncouragement','nextPracticeStep','oneLineSummary','primaryReviewPoint'] then raise exception 'invalid_report'; end if;
 for e in select key, value from jsonb_each(sec) loop
  if jsonb_typeof(e.value) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(e.value) k) is distinct from array['content','observationEvidenceIds','status','timestampRange','turnEvidenceIds'] or jsonb_typeof(e.value->'status') is distinct from 'string' or e.value->>'status' not in ('confirmed','not_confirmed') or jsonb_typeof(e.value->'observationEvidenceIds') is distinct from 'array' or jsonb_typeof(e.value->'turnEvidenceIds') is distinct from 'array' or exists(select 1 from jsonb_array_elements(e.value->'observationEvidenceIds') x where jsonb_typeof(x) is distinct from 'string' or x#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or exists(select 1 from jsonb_array_elements(e.value->'turnEvidenceIds') x where jsonb_typeof(x) is distinct from 'string' or x#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or (e.value->>'status'='confirmed' and (jsonb_typeof(e.value->'content') is distinct from 'string' or length(trim(e.value->>'content'))=0)) or (e.value->>'status'='not_confirmed' and jsonb_typeof(e.value->'content') is distinct from 'null') or jsonb_typeof(e.value->'timestampRange') not in ('null','object') then raise exception 'invalid_report_section'; end if;
  if e.value->>'status'='not_confirmed' then
   if e.key in ('oneLineSummary','primaryReviewPoint','confirmedEvidence') or e.value->'content'<>'null'::jsonb or e.value->'timestampRange'<>'null'::jsonb or jsonb_array_length(e.value->'observationEvidenceIds')<>0 or jsonb_array_length(e.value->'turnEvidenceIds')<>0 then raise exception 'invalid_unconfirmed_section'; end if;
  else
   if length(trim(e.value->>'content'))=0 then raise exception 'invalid_confirmed_section'; end if;
   if exists(
    select 1
    from jsonb_array_elements_text(e.value->'observationEvidenceIds') x
    where not exists(
     select 1
     from public.practice_sessions s
     join public.observations o on o.session_id=s.id and o.user_id=s.user_id
     where s.id=p_session_id
       and o.id=x::uuid
       and o.confirmation_state='accepted'
       and not o.blocked_for_questioning
       and o.id=any(s.report_evidence_observation_ids)
    )
   ) then raise exception 'invalid_report_evidence'; end if;
   if exists(
    select 1
    from jsonb_array_elements_text(e.value->'turnEvidenceIds') x
    where not exists(
     select 1
     from public.practice_sessions s
     join public.interview_turns t on t.session_id=s.id and t.user_id=s.user_id
     where s.id=p_session_id
       and t.id=x::uuid
       and t.role='actor'
       and t.kind='answer'
       and t.report_evidence_selected
       and t.id=any(s.report_evidence_answer_turn_ids)
    )
   ) then raise exception 'invalid_report_evidence'; end if;
   if e.key in ('oneLineSummary','confirmedEvidence') then
    if jsonb_array_length(e.value->'observationEvidenceIds')=0 or jsonb_array_length(e.value->'turnEvidenceIds')=0 or not exists(
     select 1
     from jsonb_array_elements_text(e.value->'turnEvidenceIds') x
     join public.practice_sessions s on s.id=p_session_id
     join public.interview_turns t on t.session_id=s.id and t.user_id=s.user_id
     where t.id=x::uuid and t.role='actor' and t.kind='answer' and t.report_evidence_selected and t.id=any(s.report_evidence_answer_turn_ids)
    ) then raise exception 'invalid_report_evidence'; end if;
   elsif e.key='primaryReviewPoint' then
    if jsonb_array_length(e.value->'observationEvidenceIds')=0 or e.value->'timestampRange'='null'::jsonb then raise exception 'invalid_report_evidence'; end if;
   elsif e.key='actorDiscovery' then
    if jsonb_array_length(e.value->'turnEvidenceIds')=0 then raise exception 'invalid_report_evidence'; end if;
   elsif e.key='groundedEncouragement' then
    if jsonb_array_length(e.value->'observationEvidenceIds')=0 then raise exception 'invalid_report_evidence'; end if;
   elsif e.key='nextPracticeStep' then
    if jsonb_array_length(e.value->'observationEvidenceIds')+jsonb_array_length(e.value->'turnEvidenceIds')=0 then raise exception 'invalid_report_evidence'; end if;
   end if;
   range:=e.value->'timestampRange';
   if range<>'null'::jsonb then
    if (select array_agg(k order by k) from jsonb_object_keys(range) k)<>array['endMs','startMs'] or (range->>'endMs')::integer<(range->>'startMs')::integer then raise exception 'invalid_report_timestamp'; end if;
    if not exists(
     select 1
     from jsonb_array_elements_text(e.value->'observationEvidenceIds') x
     join public.observations o on o.id=x::uuid and o.session_id=p_session_id
     where o.timestamp_start_ms=(range->>'startMs')::integer and o.timestamp_end_ms=(range->>'endMs')::integer
    ) then raise exception 'invalid_report_timestamp'; end if;
   elsif e.key='primaryReviewPoint' then
    raise exception 'invalid_report_timestamp';
   end if;
  end if;
 end loop;
 insert into public.ai_reports(session_id,user_id,source_run_id,schema_version,completion_reason,one_line_summary,primary_review_point,confirmed_evidence,actor_discovery,grounded_encouragement,next_practice_step) select p_session_id,p_user_id,p_run_id,'report.v1',completion_reason,sec->'oneLineSummary',sec->'primaryReviewPoint',sec->'confirmedEvidence',sec->'actorDiscovery',sec->'groundedEncouragement',sec->'nextPracticeStep' from public.practice_sessions where id=p_session_id;
 update public.ai_runs set status='completed',response_schema_version='report.v1',model=p_model,prompt_version=p_prompt_version,completed_at=now(),updated_at=now(),response_payload=jsonb_build_object('schemaVersion','report.v1','sessionId',p_session_id,'runId',p_run_id,'model',p_model,'promptVersion',p_prompt_version,'sections',sec) where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='running' and length(trim(p_model))>0 and p_prompt_version='acting-report.prompt.v2'; if not found then raise exception 'report_run_conflict'; end if;
 return p_report;
end $$;

revoke execute on function public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text) to service_role;
revoke execute on function public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text) to service_role;
revoke execute on function public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.acttub_complete_report_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

revoke execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text) to service_role;
revoke execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text) from public,anon,authenticated;
revoke execute on function public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.acttub_complete_report_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.acttub_fail_ai_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_safe_error_code text,p_retryable boolean)
returns setof public.ai_runs language plpgsql security definer set search_path=public as $$
begin
 if p_safe_error_code not in ('AI_TIMEOUT','AI_UNAVAILABLE','AI_INVALID_RESPONSE','AI_INTERNAL','TURN_PERSISTENCE_FAILED','SUMMARY_PERSISTENCE_FAILED','REPORT_PERSISTENCE_FAILED','REPORT_LEASE_EXPIRED') then raise exception 'invalid_safe_error_code'; end if;
 return query update public.ai_runs r set status='failed',safe_error_code=p_safe_error_code,retryable=p_retryable,completed_at=now(),updated_at=now() where r.id=p_run_id and r.session_id=p_session_id and r.user_id=p_user_id and r.status in ('pending','running') returning r.*;
 if not found then raise exception 'run_not_running'; end if;
end $$;

revoke execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text), public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb), public.acttub_complete_report_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
drop function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text);
drop function public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb);
drop function public.acttub_complete_report_run(uuid,uuid,uuid,jsonb);
revoke execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text), public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text), public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text), public.acttub_fail_ai_run(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.acttub_claim_ai_run(uuid,uuid,text,uuid,text,integer,text,text,text,text), public.acttub_complete_summary_run(uuid,uuid,uuid,jsonb,jsonb,text,text), public.acttub_complete_report_run(uuid,uuid,uuid,jsonb,text,text), public.acttub_fail_ai_run(uuid,uuid,uuid,text,boolean) to service_role;
