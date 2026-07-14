create or replace function public.acttub_complete_session_delete(p_session_id uuid,p_user_id uuid,p_request_id uuid)
returns setof public.session_deletion_attempts language plpgsql security definer set search_path=public as $$
declare v_upload_intent_id uuid;
begin
 perform 1 from public.session_deletion_attempts where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id and storage_deleted for update; if not found then raise exception 'storage_not_verified'; end if;

 delete from public.practice_sessions where id=p_session_id and user_id=p_user_id returning upload_intent_id into v_upload_intent_id;
 if not found then select id into v_upload_intent_id from public.upload_intents where session_id=p_session_id and user_id=p_user_id; end if;

 if exists(select 1 from public.practice_takes where session_id=p_session_id)
 or exists(select 1 from public.observations where session_id=p_session_id)
 or exists(select 1 from public.ai_session_summaries where session_id=p_session_id)
 or exists(select 1 from public.actor_corrections where session_id=p_session_id)
 or exists(select 1 from public.interview_turns where session_id=p_session_id)
 or exists(select 1 from public.ai_runs where session_id=p_session_id)
 or exists(select 1 from public.ai_reports where session_id=p_session_id)
 then raise exception 'delete_orphan_detected'; end if;

 if v_upload_intent_id is not null then
  delete from public.upload_intents where id=v_upload_intent_id and user_id=p_user_id and session_id=p_session_id;
 end if;

 if exists(select 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id)
 or exists(select 1 from public.practice_takes where session_id=p_session_id)
 or exists(select 1 from public.observations where session_id=p_session_id)
 or exists(select 1 from public.ai_session_summaries where session_id=p_session_id)
 or exists(select 1 from public.actor_corrections where session_id=p_session_id)
 or exists(select 1 from public.interview_turns where session_id=p_session_id)
 or exists(select 1 from public.ai_runs where session_id=p_session_id)
 or exists(select 1 from public.ai_reports where session_id=p_session_id)
 or exists(select 1 from public.upload_intents where session_id=p_session_id and user_id=p_user_id)
 then raise exception 'delete_orphan_detected'; end if;

 return query update public.session_deletion_attempts set status='completed',rows_deleted=true,safe_error_code=null,updated_at=now() where request_id=p_request_id and session_id=p_session_id and user_id=p_user_id returning *;
end $$;

revoke execute on function public.acttub_complete_session_delete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.acttub_complete_session_delete(uuid,uuid,uuid) to service_role;
