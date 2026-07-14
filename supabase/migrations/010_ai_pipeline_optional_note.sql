-- Optional terminal actor note. This row is user-authored and excluded from AI inputs.
do $$
begin
  if exists (
    select 1 from public.interview_turns t
    where t.kind = 'optional_note' and not (
      t.role = 'actor' and t.question_focus is null
      and t.grounding_start_ms is null and t.grounding_end_ms is null
      and cardinality(t.source_observation_ids) = 0
      and t.report_evidence_selected = false
      and length(trim(t.content)) between 1 and 1000
    )
  ) or exists (
    select 1 from public.interview_turns t where t.kind='optional_note'
    group by t.session_id having count(*) > 1
  ) or exists (
    select 1 from public.interview_turns note
    where note.kind='optional_note' and note.sequence <> (select max(t.sequence) from public.interview_turns t where t.session_id=note.session_id)
  ) or exists (
    select 1 from public.interview_turns t group by t.session_id
    having count(*) <> coalesce(max(t.sequence)+1,0) or min(t.sequence) <> 0
  ) then raise exception 'optional_note_integrity_precheck_failed'; end if;
end $$;

alter table public.interview_turns drop constraint if exists interview_turns_optional_note_shape_check;
alter table public.interview_turns add constraint interview_turns_optional_note_shape_check check (
  kind <> 'optional_note' or (
    role = 'actor' and question_focus is null
    and grounding_start_ms is null and grounding_end_ms is null
    and cardinality(source_observation_ids) = 0
    and report_evidence_selected = false
    and length(trim(content)) between 1 and 1000
  )
);
create unique index interview_turns_one_optional_note_per_session_idx
  on public.interview_turns(session_id) where kind='optional_note';

create or replace function public.acttub_put_optional_note(
  p_session_id uuid, p_user_id uuid, p_turn_id uuid, p_content text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  session_row public.practice_sessions%rowtype;
  existing public.interview_turns%rowtype;
  normalized text := nullif(trim(p_content), '');
  turn_count integer;
  maximum_sequence integer;
begin
  if p_session_id is null or p_user_id is null or p_turn_id is null then raise exception 'invalid_optional_note_identity'; end if;
  if normalized is not null and length(normalized) > 1000 then raise exception 'invalid_optional_note'; end if;

  select s.* into session_row from public.practice_sessions s
   where s.id=p_session_id and s.user_id=p_user_id and s.pipeline_version='ai-pipeline.v1' for update;
  if not found or session_row.hidden_at is not null or session_row.deletion_status <> 'active'
    or not (
      (session_row.interview_status='completed' and session_row.completion_reason in ('interview_complete_report_ready','manual_stop_report_ready','hard_limit_report_ready'))
      or (session_row.interview_status='completed_without_report' and session_row.completion_reason in ('insufficient_confirmed_evidence','insufficient_interview_evidence'))
    ) then raise exception 'optional_note_session_not_found'; end if;

  perform 1 from public.interview_turns t where t.session_id=p_session_id and t.user_id=p_user_id for update;
  select count(*), max(t.sequence) into turn_count, maximum_sequence
    from public.interview_turns t where t.session_id=p_session_id and t.user_id=p_user_id;
  if turn_count <> coalesce(maximum_sequence + 1, 0) then raise exception 'non_contiguous_transcript'; end if;

  select t.* into existing from public.interview_turns t
   where t.session_id=p_session_id and t.user_id=p_user_id and t.kind='optional_note';
  if found and existing.sequence <> maximum_sequence then raise exception 'optional_note_not_last'; end if;

  if normalized is null then
    if existing.id is not null then delete from public.interview_turns where id=existing.id; end if;
    return jsonb_build_object('optionalNote', null);
  end if;
  if existing.id is not null then
    if existing.content is distinct from normalized then update public.interview_turns set content=normalized where id=existing.id; end if;
  else
    insert into public.interview_turns(id,session_id,user_id,sequence,role,kind,content,question_focus,grounding_start_ms,grounding_end_ms,source_observation_ids,report_evidence_selected)
    values(p_turn_id,p_session_id,p_user_id,turn_count,'actor','optional_note',normalized,null,null,null,'{}'::uuid[],false);
  end if;
  return jsonb_build_object('optionalNote', normalized);
end $$;

revoke all on function public.acttub_put_optional_note(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.acttub_put_optional_note(uuid,uuid,uuid,text) to service_role;
