-- FastAPI request-validation 422 responses happen before handler side effects.
-- Persist that narrow contract failure definitively and allow an explicit new-ID
-- recovery after the platform/upstream deployment contract is corrected.

create or replace function public.acttub_error_replay_payload(
  p_phase text,p_failure_class text,p_safe_error_code text,p_run_id uuid default null
) returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'status',case
      when p_safe_error_code='acting_api_rate_limited' then 429
      when p_safe_error_code in ('video_too_large','acting_video_too_large') then 413
      when p_safe_error_code='source_video_unavailable' then 503
      when p_safe_error_code in ('acting_api_auth_failed','acting_api_rejected','acting_api_contract_mismatch') then 502
      else 409 end,
    'error',jsonb_build_object(
      'code',case when p_failure_class='ambiguous' then
        case p_phase when 'analysis' then 'analysis_outcome_unknown' when 'report' then 'report_outcome_unknown' else 'upstream_outcome_unknown' end
        else p_safe_error_code end
    ) || case
      when p_safe_error_code='acting_api_contract_mismatch' then jsonb_build_object(
        'message','The acting service could not accept this request.'
      )
      else '{}'::jsonb
    end || case
      when p_failure_class='ambiguous' then jsonb_build_object('details',jsonb_strip_nulls(jsonb_build_object(
        'causeCode',p_safe_error_code,
        'retryAllowed',false,
        'action',case when p_phase='analysis' then 'create_new_session' when p_phase='report' then 'contact_support' else 'restart_interview' end,
        'runId',case when p_phase='coach' then p_run_id end
      )))
      when p_safe_error_code='source_video_unavailable' then jsonb_build_object('details',jsonb_build_object(
        'retryAllowed',true,
        'action','retry_analysis'
      ))
      when p_safe_error_code='acting_session_expired' then jsonb_build_object('details',jsonb_strip_nulls(jsonb_build_object(
        'action','restart_interview','runId',p_run_id
      )))
      else '{}'::jsonb
    end
  )
$$;

create or replace function public.acttub_fail_analysis(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_failure_class text,p_safe_error_code text)
returns void language plpgsql security definer set search_path=public as $$ begin
 if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
 update public.practice_upstream_operations set status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,
   safe_error_code=p_safe_error_code,response_payload=public.acttub_error_replay_payload('analysis',p_failure_class,p_safe_error_code,null),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and user_id=p_user_id and kind in ('analysis_create','analysis_retry') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_takes set analysis_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,analysis_error=p_safe_error_code,analysis_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited','source_video_unavailable','acting_api_contract_mismatch')) where session_id=p_session_id and user_id=p_user_id;
end $$;

create or replace function public.acttub_fail_coach_operation(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_operation_id uuid,p_lease_token uuid,p_actor_turn_id uuid,p_failure_class text,p_safe_error_code text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_failure_class not in ('definitive','ambiguous') then raise exception 'invalid_failure_class'; end if;
 update public.practice_upstream_operations set status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,safe_error_code=p_safe_error_code,
   response_payload=public.acttub_error_replay_payload('coach',p_failure_class,p_safe_error_code,p_run_id),finished_at=clock_timestamp()
 where id=p_operation_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'upstream_outcome_unknown'; end if;
 update public.practice_turns set delivery_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,delivery_error_code=p_safe_error_code,delivery_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited','acting_api_contract_mismatch')) where p_actor_turn_id is not null and id=p_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and request_id=(select request_id from public.practice_upstream_operations where id=p_operation_id);
 update public.practice_interview_runs set status=case when p_failure_class='ambiguous' then 'outcome_unknown' when status='starting' then 'start_failed' else status end,failure_code=p_safe_error_code,failure_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited','acting_api_contract_mismatch')),ended_at=case when p_failure_class='ambiguous' or status='starting' then clock_timestamp() else ended_at end where id=p_run_id and session_id=p_session_id and user_id=p_user_id;
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
 select * into replay from public.practice_upstream_operations where session_id=p_session_id and user_id=p_user_id and kind='report' and status='failed' and safe_error_code not in ('acting_api_auth_failed','acting_api_rate_limited','acting_api_contract_mismatch') order by finished_at desc limit 1;
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

notify pgrst, 'reload schema';
