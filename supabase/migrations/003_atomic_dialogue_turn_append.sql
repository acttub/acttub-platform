-- Serialize dialogue turn appends and reject stale answer-count expectations.
-- The application generates outside the transaction, then supplies the actor count it observed.

drop function if exists public.acttub_append_turn_pair(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  uuid[],
  timestamptz
);

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

revoke execute on function public.acttub_append_turn_pair(uuid, uuid, integer, uuid, text, text, uuid, text, text, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.acttub_append_turn_pair(uuid, uuid, integer, uuid, text, text, uuid, text, text, uuid[], timestamptz) to service_role;
