create or replace function public.acttub_claim_coach_reply(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_request_id uuid,p_request_fingerprint text,p_operation_id uuid,p_actor_turn_id uuid,p_actor_text text,p_retry_actor_turn_id uuid,p_lease_token uuid,p_lease_seconds integer)
returns table(operation_id uuid,claim_state text,acting_session_id text,actor_turn_id uuid,actor_text text) language plpgsql security definer set search_path=public as $$ declare r public.practice_interview_runs%rowtype; next_ordinal integer; replay record; replay_turn public.practice_turns%rowtype; begin
 if p_retry_actor_turn_id is null
   and (nullif(trim(p_actor_text), '') is null or char_length(trim(p_actor_text)) > 2000)
 then raise exception 'practice_reply_too_large' using errcode = 'P0001'; end if;
 if p_lease_seconds<>120 then raise exception 'invalid_lease'; end if;
 select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint); if replay.found then select * into replay_turn from public.practice_turns where user_id=p_user_id and request_id=p_request_id; select * into r from public.practice_interview_runs where id=replay.run_id and user_id=p_user_id; return query select replay.operation_id,replay.claim_state,r.acting_session_id,replay_turn.id,replay_turn.text; return; end if;
 select o.id as operation_id into replay from public.practice_upstream_operations o where o.session_id=p_session_id and o.user_id=p_user_id and o.run_id=p_run_id and kind in ('coach_start','coach_reply','coach_retry_reply') and status='outcome_unknown' order by finished_at desc limit 1;
 if found then select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id; return query select replay.operation_id,'outcome_unknown',r.acting_session_id,null::uuid,null::text; return; end if;
 perform public.acttub_preflight_operation(p_session_id,p_user_id,false);
 select * into r from public.practice_interview_runs where id=p_run_id and session_id=p_session_id and user_id=p_user_id and status='live' for update; if not found then raise exception 'invalid_run'; end if;
 if p_retry_actor_turn_id is null then select coalesce(max(ordinal),0)+1 into next_ordinal from public.practice_turns where session_id=p_session_id and run_id=p_run_id; insert into public.practice_turns(id,session_id,user_id,run_id,ordinal,role,delivery_status,request_id,text) values(p_actor_turn_id,p_session_id,p_user_id,p_run_id,next_ordinal,'actor','pending',p_request_id,trim(p_actor_text)); else update public.practice_turns set request_id=p_request_id,delivery_status='pending',delivery_error_code=null,delivery_retryable=null where id=p_retry_actor_turn_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and role='actor' and delivery_status='failed' and delivery_retryable returning text into p_actor_text; if not found or nullif(trim(p_actor_text),'') is null then raise exception 'retry_actor_not_eligible'; end if; p_actor_turn_id:=p_retry_actor_turn_id; end if;
 insert into public.practice_upstream_operations(id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at) values(p_operation_id,p_session_id,p_user_id,p_run_id,p_request_id,p_request_fingerprint,case when p_retry_actor_turn_id is null then 'coach_reply' else 'coach_retry_reply' end,'in_flight',p_lease_token,clock_timestamp()+interval '120 seconds'); return query select p_operation_id,'claimed',r.acting_session_id,p_actor_turn_id,p_actor_text; end $$;

create or replace function public.acttub_complete_coach_turn(p_session_id uuid,p_user_id uuid,p_run_id uuid,p_operation_id uuid,p_lease_token uuid,p_acting_session_id text,p_ai_turn_id uuid,p_question text,p_action text,p_focus_timestamp text,p_done boolean,p_close_reason text,p_response_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
 n integer;
 v_kind text;
 v_request_id uuid;
 v_actor_turn_count integer;
begin
 select kind,request_id into v_kind,v_request_id from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and kind in ('coach_start','coach_restart','coach_reply','coach_retry_reply') and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update; if not found then raise exception 'upstream_outcome_unknown'; end if;
 if v_kind in ('coach_reply','coach_retry_reply') then
   update public.practice_turns set delivery_status='completed' where session_id=p_session_id and run_id=p_run_id and user_id=p_user_id and role='actor' and delivery_status='pending' and request_id=v_request_id;
   get diagnostics v_actor_turn_count = row_count;
   if v_actor_turn_count <> 1 then raise exception 'coach_actor_turn_cardinality_mismatch' using errcode = 'P0001'; end if;
 end if;
 update public.practice_interview_runs set acting_session_id=p_acting_session_id,status=case when p_done then 'completed' else 'live' end,close_reason=case when p_done then p_close_reason else null end,ended_at=case when p_done then clock_timestamp() else null end where id=p_run_id and session_id=p_session_id and user_id=p_user_id; select coalesce(max(ordinal),0)+1 into n from public.practice_turns where run_id=p_run_id; insert into public.practice_turns(id,session_id,user_id,run_id,ordinal,role,delivery_status,text,action,focus_timestamp) values(p_ai_turn_id,p_session_id,p_user_id,p_run_id,n,'ai','completed',p_question,p_action,p_focus_timestamp); update public.practice_sessions set status=case when p_done then 'report' else 'interview' end,updated_at=clock_timestamp() where id=p_session_id and user_id=p_user_id and pipeline_version='acting-api-v1';
 update public.practice_upstream_operations set status='completed',response_payload=public.acttub_public_session_payload(p_session_id,p_user_id),finished_at=clock_timestamp() where id=p_operation_id;
end $$;

revoke all on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.acttub_claim_coach_reply(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,uuid,integer) to service_role;
revoke all on function public.acttub_complete_coach_turn(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean,text,jsonb) from public, anon, authenticated;
grant execute on function public.acttub_complete_coach_turn(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean,text,jsonb) to service_role;

notify pgrst, 'reload schema';
