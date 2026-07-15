-- Keep source preparation failures definitive and retryable. The upstream
-- acting-api has not been dispatched when this code is persisted.

create or replace function public.acttub_error_replay_payload(
  p_phase text,p_failure_class text,p_safe_error_code text,p_run_id uuid default null
) returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'status',case
      when p_safe_error_code='acting_api_rate_limited' then 429
      when p_safe_error_code in ('video_too_large','acting_video_too_large') then 413
      when p_safe_error_code='source_video_unavailable' then 503
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
 update public.practice_takes set analysis_status=case when p_failure_class='ambiguous' then 'outcome_unknown' else 'failed' end,analysis_error=p_safe_error_code,analysis_retryable=(p_failure_class='definitive' and p_safe_error_code in ('acting_api_auth_failed','acting_api_rate_limited','source_video_unavailable')) where session_id=p_session_id and user_id=p_user_id;
end $$;
