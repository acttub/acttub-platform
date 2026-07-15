create index if not exists practice_sessions_visible_owner_created_id_idx
  on public.practice_sessions (user_id, created_at desc, id desc)
  where hidden_at is null;

create or replace function public.acttub_list_owned_practice_session_summaries(
  p_user_id uuid,
  p_limit integer,
  p_snapshot_at timestamptz default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table(
  id uuid,
  pipeline_version text,
  legacy boolean,
  status text,
  title text,
  preview text,
  duration_ms integer,
  analysis_status text,
  created_at timestamptz,
  updated_at timestamptz,
  snapshot_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, statement_timestamp());
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_limit is null or p_limit < 2 or p_limit > 51 then raise exception 'invalid_limit'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'incomplete_keyset'; end if;
  if p_before_created_at > v_snapshot_at then raise exception 'keyset_after_snapshot'; end if;

  return query
  select
    s.id,
    case when s.pipeline_version = 'acting-api-v1' then 'acting-api-v1' else 'legacy-gemini-v1' end,
    s.pipeline_version is distinct from 'acting-api-v1',
    case
      when s.pipeline_version = 'acting-api-v1' then upper(s.status)
      when s.status = 'completed' then 'LEGACY_COMPLETED'
      when s.status = 'questioning' then 'LEGACY_QUESTIONING'
      else 'LEGACY_OBSERVATIONS_PENDING'
    end,
    left(case
      when s.pipeline_version = 'acting-api-v1' then coalesce(nullif(btrim(s.situation), ''), '연기 연습')
      else coalesce(nullif(btrim(s.genre), ''), nullif(btrim(s.situation), ''), '이전 버전 연습')
    end, 120),
    left(nullif(case
      when s.pipeline_version = 'acting-api-v1' then coalesce(
        report.payload ->> 'headline', actor_turn.text,
        scene.payload ->> 'summary', nullif(btrim(s.situation), '')
      )
      else nullif(btrim(s.situation), '')
    end, ''), 240),
    coalesce(take.duration_ms, take.reported_duration_ms)::integer,
    case
      when s.pipeline_version = 'acting-api-v1' then take.analysis_status
      when take.analysis_status = 'failed' then 'failed'
      else 'generated'
    end,
    s.created_at,
    s.updated_at,
    v_snapshot_at
  from public.practice_sessions s
  left join lateral (
    select t.duration_ms, t.reported_duration_ms, t.analysis_status
    from public.practice_takes t
    where t.session_id = s.id and t.user_id = s.user_id
    order by t.created_at desc, t.id desc limit 1
  ) take on true
  left join lateral (
    select r.payload from public.practice_reports r
    where r.session_id = s.id and r.user_id = s.user_id
    order by r.created_at desc limit 1
  ) report on true
  left join lateral (
    select pt.text from public.practice_turns pt
    where pt.session_id = s.id and pt.user_id = s.user_id
      and pt.run_id = s.interview_run_id and pt.role = 'actor'
      and pt.delivery_status = 'completed'
    order by pt.ordinal desc limit 1
  ) actor_turn on true
  left join lateral (
    select ss.payload from public.scene_summaries ss
    where ss.session_id = s.id and ss.user_id = s.user_id limit 1
  ) scene on true
  where s.user_id = p_user_id
    and s.hidden_at is null
    and s.created_at <= v_snapshot_at
    and (p_before_created_at is null or (s.created_at, s.id) < (p_before_created_at, p_before_id))
  order by s.created_at desc, s.id desc
  limit p_limit;
end
$$;

revoke all on function public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)
  to service_role;

notify pgrst, 'reload schema';
