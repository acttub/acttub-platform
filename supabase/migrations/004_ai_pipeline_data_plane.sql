-- Additive AI pipeline v1 data plane. Legacy rows remain valid and are never backfilled into AI consent.
alter table public.profiles
  add column if not exists required_consent_version text,
  add column if not exists required_consent_at timestamptz,
  add column if not exists ai_processing_consent_version text,
  add column if not exists ai_processing_consent_at timestamptz,
  add column if not exists internal_review_consent boolean not null default false,
  add column if not exists internal_review_consent_updated_at timestamptz;

alter table public.profiles drop constraint if exists active_profile_requires_current_consent;
alter table public.profiles add constraint active_profile_requires_current_consent check (
  not is_active or (required_consent_version is not null and required_consent_at is not null
    and ai_processing_consent_version is not null and ai_processing_consent_at is not null)
);
create or replace function public.is_active_acttub_profile(profile_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.user_id=profile_user_id and p.is_active
    and p.required_consent_version is not null and p.required_consent_at is not null
    and p.ai_processing_consent_version is not null and p.ai_processing_consent_at is not null)
$$;

alter table public.upload_intents
  add column if not exists required_consent_version_snapshot text,
  add column if not exists ai_processing_consent_version_snapshot text,
  add column if not exists adult_confirmed_at timestamptz,
  add column if not exists all_participants_confirmed_at timestamptz,
  add column if not exists authoritative_duration_ms integer check(authoritative_duration_ms is null or authoritative_duration_ms between 1 and 300000),
  add column if not exists media_metadata_version text check(media_metadata_version is null or media_metadata_version='iso-bmff-duration.v1'),
  add column if not exists ai_eligible_at timestamptz;

alter table public.practice_sessions
  add column if not exists pipeline_version text check(pipeline_version is null or pipeline_version='ai-pipeline.v1'),
  add column if not exists required_consent_version_snapshot text,
  add column if not exists ai_processing_consent_version_snapshot text,
  add column if not exists adult_confirmed_at timestamptz,
  add column if not exists all_participants_confirmed_at timestamptz,
  add column if not exists interview_status text check(interview_status is null or interview_status in ('active','paused','completed','completed_without_report')),
  add column if not exists completion_reason text check(completion_reason is null or completion_reason in ('interview_complete_report_ready','manual_stop_report_ready','manual_stop_paused','hard_limit_report_ready','insufficient_confirmed_evidence','insufficient_interview_evidence')),
  add column if not exists substantive_answer_count integer check(substantive_answer_count is null or substantive_answer_count between 0 and 10),
  add column if not exists report_evidence_observation_ids uuid[] not null default '{}',
  add column if not exists report_evidence_answer_turn_ids uuid[] not null default '{}',
  add column if not exists deletion_status text not null default 'active' check(deletion_status in ('active','deleting','delete_failed')),
  add column if not exists delete_request_id uuid,
  add column if not exists delete_error_code text,
  add column if not exists delete_started_at timestamptz,
  add column if not exists delete_updated_at timestamptz,
  add constraint pipeline_consent_snapshots check(pipeline_version is null or
    (required_consent_version_snapshot is not null and ai_processing_consent_version_snapshot is not null and adult_confirmed_at is not null and all_participants_confirmed_at is not null)),
  add constraint deletion_request_required check(deletion_status='active' or delete_request_id is not null);

alter table public.practice_takes add column if not exists media_metadata_version text check(media_metadata_version is null or media_metadata_version='iso-bmff-duration.v1');
alter table public.practice_takes add constraint pipeline_take_duration check(duration_ms is null or duration_ms between 1 and 300000) not valid;
alter table public.observations alter column confidence drop not null;
alter table public.observations
  add column if not exists candidate_id uuid,
  add column if not exists priority integer check(priority is null or priority>0),
  add column if not exists dimension text,
  add column if not exists severity text check(severity is null or severity in ('high','mid','low')),
  add column if not exists source_run_id uuid,
  add constraint rejected_observations_are_blocked check(confirmation_state not in ('rejected','unsure') or blocked_for_questioning);

create table public.ai_runs (
 id uuid primary key, session_id uuid not null, user_id uuid not null, stage text not null check(stage in ('summary','agent','report','delete')),
 status text not null check(status in ('pending','running','completed','failed')), idempotency_key text not null, attempt integer not null default 0 check(attempt>=0),
 max_attempts integer not null check(max_attempts between 1 and 5), request_schema_version text, response_schema_version text, model text, prompt_version text,
 safe_error_code text, retryable boolean not null default false, started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(session_id,stage,idempotency_key), foreign key(session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
 check(status<>'running' or started_at is not null), check(status not in ('completed','failed') or completed_at is not null),
 check(status<>'completed' or safe_error_code is null), check(status<>'failed' or safe_error_code is not null)
);
create table public.ai_session_summaries (
 session_id uuid primary key, user_id uuid not null, take_id uuid not null, schema_version text not null check(schema_version='scene-summary.v1'),
 subtext_status text not null check(subtext_status in ('provided','not_provided')), normalized_summary jsonb not null, source_run_id uuid not null unique references public.ai_runs(id), created_at timestamptz not null default now(),
 unique(session_id,user_id), foreign key(session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
 foreign key(take_id,session_id,user_id) references public.practice_takes(id,session_id,user_id) on delete cascade
);
create table public.interview_turns (
 id uuid primary key, session_id uuid not null, user_id uuid not null, sequence integer not null check(sequence>=0), role text not null check(role in ('agent','actor')),
 kind text not null check(kind in ('question','closing','answer','unknown','observation_confirmation','actor_correction','optional_note')), content text not null check(length(trim(content))>0), question_focus text,
 grounding_start_ms integer check(grounding_start_ms>=0), grounding_end_ms integer check(grounding_end_ms>=grounding_start_ms), source_observation_ids uuid[] not null default '{}', report_evidence_selected boolean not null default false,
 created_at timestamptz not null default now(), unique(session_id,sequence), unique(id,session_id,user_id), foreign key(session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade
);
create table public.actor_corrections (
 id uuid primary key, session_id uuid not null, user_id uuid not null, observation_id uuid not null, content text not null check(length(trim(content))>0), correction_by_turn_id uuid not null,
 created_at timestamptz not null default now(), unique(session_id,observation_id), foreign key(session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
 foreign key(observation_id,session_id,user_id) references public.observations(id,session_id,user_id) on delete cascade,
 foreign key(correction_by_turn_id,session_id,user_id) references public.interview_turns(id,session_id,user_id) on delete cascade
);
create table public.ai_reports (
 session_id uuid primary key, user_id uuid not null, source_run_id uuid not null unique references public.ai_runs(id), schema_version text not null check(schema_version='report.v1'), completion_reason text not null,
 one_line_summary jsonb not null, primary_review_point jsonb not null, confirmed_evidence jsonb not null, actor_discovery jsonb not null, grounded_encouragement jsonb not null, next_practice_step jsonb not null,
 created_at timestamptz not null default now(), foreign key(session_id,user_id) references public.practice_sessions(id,user_id) on delete cascade,
 check(one_line_summary->>'status'='confirmed' and length(trim(one_line_summary->>'content'))>0),
 check(primary_review_point->>'status'='confirmed' and length(trim(primary_review_point->>'content'))>0),
 check(confirmed_evidence->>'status'='confirmed' and length(trim(confirmed_evidence->>'content'))>0)
);
create table public.session_deletion_attempts (
 request_id uuid primary key, session_id uuid not null, user_id uuid not null, status text not null check(status in ('running','failed','completed')),
 storage_deleted boolean not null default false, rows_deleted boolean not null default false, safe_error_code text, attempt integer not null default 1 check(attempt>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'completed' or (storage_deleted and rows_deleted and safe_error_code is null))
);

create unique index observations_session_candidate_uidx on public.observations(session_id,candidate_id) where candidate_id is not null;
create unique index ai_runs_one_active_stage_uidx on public.ai_runs(session_id,stage) where status in ('pending','running');
create index ai_runs_session_stage_created_idx on public.ai_runs(session_id,stage,created_at desc);
create index ai_runs_failed_retry_idx on public.ai_runs(status,retryable,updated_at) where status='failed' and retryable;
create index observations_session_priority_idx on public.observations(session_id,priority);
create index observations_confirmation_idx on public.observations(session_id,confirmation_state,blocked_for_questioning);
create index interview_turns_session_sequence_idx on public.interview_turns(session_id,sequence);
create index interview_turns_report_evidence_idx on public.interview_turns(session_id,report_evidence_selected) where report_evidence_selected;
create index actor_corrections_session_idx on public.actor_corrections(session_id,created_at);
create index session_deletion_reconcile_idx on public.practice_sessions(deletion_status,delete_updated_at) where deletion_status<>'active';
create index session_deletion_attempts_reconcile_idx on public.session_deletion_attempts(status,updated_at) where status in ('failed','running');

alter table public.ai_session_summaries enable row level security; alter table public.ai_runs enable row level security; alter table public.actor_corrections enable row level security;
alter table public.interview_turns enable row level security; alter table public.ai_reports enable row level security; alter table public.session_deletion_attempts enable row level security;
revoke insert,update,delete on public.ai_session_summaries,public.ai_runs,public.actor_corrections,public.interview_turns,public.ai_reports,public.session_deletion_attempts from anon,authenticated;
grant select on public.ai_session_summaries,public.ai_runs,public.actor_corrections,public.interview_turns,public.ai_reports to authenticated;

do $$ declare t text; begin foreach t in array array['ai_session_summaries','ai_runs','actor_corrections','interview_turns','ai_reports'] loop
 execute format('create policy %I on public.%I for select to authenticated using (user_id=auth.uid() and exists(select 1 from public.practice_sessions s where s.id=session_id and s.user_id=auth.uid() and s.hidden_at is null and s.deletion_status=''active'' and public.is_active_acttub_profile(auth.uid())))',t||'_owner_select',t);
end loop; end $$;

-- All mutation functions are service-role transaction boundaries. Each locks and owner-checks the session.
create or replace function public.acttub_claim_ai_run(p_session_id uuid,p_user_id uuid,p_stage text,p_run_id uuid,p_idempotency_key text,p_max_attempts integer)
returns setof public.ai_runs language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and pipeline_version='ai-pipeline.v1' and deletion_status='active' for update;
 if not found then raise exception 'pipeline_session_not_found'; end if;
 return query insert into public.ai_runs(id,session_id,user_id,stage,status,idempotency_key,attempt,max_attempts,started_at)
 values(p_run_id,p_session_id,p_user_id,p_stage,'running',p_idempotency_key,1,p_max_attempts,now())
 on conflict(session_id,stage,idempotency_key) do update set updated_at=now() returning *;
end $$;
create or replace function public.acttub_fail_ai_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_safe_error_code text,p_retryable boolean)
returns setof public.ai_runs language plpgsql security definer set search_path=public as $$ begin
 return query update public.ai_runs set status='failed',safe_error_code=p_safe_error_code,retryable=p_retryable,completed_at=now(),updated_at=now()
 where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='running' returning *; end $$;
create or replace function public.acttub_confirm_observation(p_session_id uuid,p_user_id uuid,p_observation_id uuid,p_state text,p_correction text default null,p_correction_id uuid default null,p_turn_id uuid default null)
returns setof public.observations language plpgsql security definer set search_path=public as $$ declare seq integer; begin
 perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and deletion_status='active' for update; if not found then raise exception 'session_not_found'; end if;
 if p_state not in ('accepted','rejected','unsure') or (p_correction is not null and (p_state<>'rejected' or length(trim(p_correction))=0)) then raise exception 'invalid_confirmation'; end if;
 if p_correction is not null then select coalesce(max(sequence)+1,0) into seq from public.interview_turns where session_id=p_session_id;
 insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content) values(p_turn_id,p_session_id,p_user_id,seq,'actor','actor_correction',p_correction);
 insert into public.actor_corrections(id,session_id,user_id,observation_id,content,correction_by_turn_id) values(p_correction_id,p_session_id,p_user_id,p_observation_id,p_correction,p_turn_id);
 end if; return query update public.observations set confirmation_state=p_state,blocked_for_questioning=(p_state<>'accepted') where id=p_observation_id and session_id=p_session_id and user_id=p_user_id returning *; end $$;
create or replace function public.acttub_begin_session_delete(p_session_id uuid,p_user_id uuid,p_request_id uuid)
returns setof public.session_deletion_attempts language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id for update; if not found then return query select * from public.session_deletion_attempts where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id; return; end if;
 update public.practice_sessions set deletion_status='deleting',delete_request_id=p_request_id,delete_started_at=coalesce(delete_started_at,now()),delete_updated_at=now() where id=p_session_id;
 return query insert into public.session_deletion_attempts(request_id,session_id,user_id,status) values(p_request_id,p_session_id,p_user_id,'running') on conflict(request_id) do update set attempt=session_deletion_attempts.attempt+1,updated_at=now() returning *; end $$;
create or replace function public.acttub_record_storage_deleted(p_session_id uuid,p_user_id uuid,p_request_id uuid)
returns setof public.session_deletion_attempts language sql security definer set search_path=public as $$ update public.session_deletion_attempts set storage_deleted=true,updated_at=now() where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id returning * $$;
create or replace function public.acttub_fail_session_delete(p_session_id uuid,p_user_id uuid,p_request_id uuid,p_safe_error_code text)
returns setof public.session_deletion_attempts language plpgsql security definer set search_path=public as $$ begin update public.practice_sessions set deletion_status='delete_failed',delete_error_code=p_safe_error_code,delete_updated_at=now() where id=p_session_id and user_id=p_user_id; return query update public.session_deletion_attempts set status='failed',safe_error_code=p_safe_error_code,updated_at=now() where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id returning *; end $$;
create or replace function public.acttub_complete_session_delete(p_session_id uuid,p_user_id uuid,p_request_id uuid)
returns setof public.session_deletion_attempts language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from public.session_deletion_attempts where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id and storage_deleted) then raise exception 'storage_not_verified'; end if;
 delete from public.practice_sessions where id=p_session_id and user_id=p_user_id; return query update public.session_deletion_attempts set status='completed',rows_deleted=true,safe_error_code=null,updated_at=now() where request_id=p_request_id returning *; end $$;

-- Remaining payload-heavy boundaries accept typed JSON documents and validate ownership/run state before atomically persisting.
create or replace function public.acttub_complete_summary_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_summary jsonb,p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ begin perform 1 from public.ai_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id and stage='summary' and status='running' for update; if not found then raise exception 'run_not_running'; end if; return jsonb_build_object('session_id',p_session_id,'run_id',p_run_id); end $$;
create or replace function public.acttub_append_pipeline_turn(p_session_id uuid,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ begin perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and interview_status in ('active','paused') and deletion_status='active' for update; if not found then raise exception 'session_not_mutable'; end if; return p_payload; end $$;
create or replace function public.acttub_complete_interview(p_session_id uuid,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ begin perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and deletion_status='active' for update; if not found then raise exception 'session_not_mutable'; end if; return p_payload; end $$;
create or replace function public.acttub_complete_report_run(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_report jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ begin perform 1 from public.ai_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id and stage='report' and status='running' for update; if not found then raise exception 'run_not_running'; end if; return p_report; end $$;
create or replace function public.acttub_create_pipeline_session(p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ begin perform 1 from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id and status='finalized' and ai_eligible_at is not null and authoritative_duration_ms between 1 and 300000 and media_metadata_version='iso-bmff-duration.v1' for update; if not found then raise exception 'upload_not_ai_eligible'; end if; return jsonb_build_object('session_id',p_session_id,'take_id',p_take_id); end $$;

do $$ declare f text; begin foreach f in array array['acttub_create_pipeline_session','acttub_claim_ai_run','acttub_complete_summary_run','acttub_confirm_observation','acttub_append_pipeline_turn','acttub_complete_interview','acttub_complete_report_run','acttub_fail_ai_run','acttub_begin_session_delete','acttub_record_storage_deleted','acttub_complete_session_delete','acttub_fail_session_delete'] loop execute format('revoke execute on function public.%I from public,anon,authenticated',f); execute format('grant execute on function public.%I to service_role',f); end loop; end $$;
