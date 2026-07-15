-- Durable abandoned-upload cleanup and one DB-atomic per-user quota boundary.

alter table public.upload_intents
  add column actual_size_bytes bigint check (actual_size_bytes is null or actual_size_bytes between 1 and 576716800),
  add column consumed_at timestamptz,
  add column cleanup_completed_at timestamptz;

update public.upload_intents u set consumed_at=coalesce(s.created_at,clock_timestamp())
from public.practice_sessions s where s.upload_intent_id=u.id and u.consumed_at is null;

create index upload_intents_active_quota_idx on public.upload_intents(user_id)
  where consumed_at is null and cleanup_completed_at is null;
create index upload_intents_cleanup_candidate_idx on public.upload_intents(expires_at,id)
  where consumed_at is null and cleanup_completed_at is null;

create table public.upload_quota_policy (
  singleton boolean primary key default true check (singleton),
  max_active_intents integer not null check (max_active_intents between 1 and 100),
  max_active_bytes bigint not null check (max_active_bytes between 1 and 11534336000),
  created_or_finalized_grace interval not null check (created_or_finalized_grace between interval '1 minute' and interval '7 days'),
  validation_failed_grace interval not null check (validation_failed_grace between interval '0 seconds' and interval '1 day'),
  completed_tombstone_retention interval not null check (completed_tombstone_retention between interval '1 day' and interval '365 days')
);
insert into public.upload_quota_policy values (true,5,1153433600,interval '30 minutes',interval '5 minutes',interval '30 days');
alter table public.upload_quota_policy enable row level security;
revoke all on public.upload_quota_policy from public,anon,authenticated;

create table public.upload_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  upload_intent_id uuid not null unique references public.upload_intents(id) on delete cascade,
  reason text not null check (reason in ('expired_unfinalized','abandoned_finalized','validation_failed','session_delete')),
  status text not null default 'queued' check (status in ('queued','in_flight','failed','completed')),
  lease_token uuid, lease_expires_at timestamptz, worker_id text,
  attempt_count integer not null default 0 check (attempt_count>=0),
  available_at timestamptz not null default clock_timestamp(), last_attempt_at timestamptz,
  safe_error_code text check (safe_error_code is null or safe_error_code in ('storage_delete_failed','storage_inspection_failed','storage_object_changed','invalid_cleanup_object','worker_crash','timeout')),
  observed_size_bytes bigint, cleaned_size_bytes bigint, object_existed boolean,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  check ((status='in_flight')=(lease_token is not null and lease_expires_at is not null)),
  check ((status='completed')=(completed_at is not null))
);
create index upload_cleanup_jobs_claim_idx on public.upload_cleanup_jobs(status,available_at);
alter table public.upload_cleanup_jobs enable row level security;
revoke all on public.upload_cleanup_jobs from public,anon,authenticated;

create or replace function public.acttub_upload_quota_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare policy public.upload_quota_policy%rowtype; active_count bigint; active_bytes numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||new.user_id::text,0));
  select * into strict policy from public.upload_quota_policy where singleton for share;
  select count(*),coalesce(sum(coalesce(actual_size_bytes,expected_size_bytes)),0) into active_count,active_bytes
    from public.upload_intents where user_id=new.user_id and consumed_at is null and cleanup_completed_at is null;
  if active_count+1>policy.max_active_intents or active_bytes+new.expected_size_bytes>policy.max_active_bytes then
    raise exception 'upload_quota_exceeded' using errcode='P0001',detail=format('count=%s/%s bytes=%s/%s',active_count,policy.max_active_intents,active_bytes,policy.max_active_bytes);
  end if;
  return new;
end $$;
create trigger upload_intents_quota_guard before insert on public.upload_intents for each row execute function public.acttub_upload_quota_guard();

create or replace function public.acttub_create_upload_intent(
  p_user_id uuid,p_request_id uuid,p_request_fingerprint text,p_upload_intent_id uuid,p_session_id uuid,
  p_storage_bucket text,p_storage_path text,p_mime_type text,p_size_bytes bigint,p_expires_at timestamptz
) returns setof public.upload_intents language plpgsql security definer set search_path=public as $$
declare claimed public.upload_intents%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  select * into claimed from public.upload_intents where user_id=p_user_id and request_id=p_request_id;
  if found then
    if claimed.request_fingerprint is distinct from p_request_fingerprint then raise exception 'request_id_conflict' using errcode='P0001'; end if;
    return next claimed; return;
  end if;
  insert into public.upload_intents(id,user_id,session_id,status,expected_storage_bucket,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at,request_id,request_fingerprint)
    values(p_upload_intent_id,p_user_id,p_session_id,'created',p_storage_bucket,p_storage_path,p_mime_type,p_size_bytes,p_expires_at,p_request_id,p_request_fingerprint)
    returning * into claimed;
  return next claimed;
end $$;

create or replace function public.acttub_enqueue_upload_cleanup(p_upload_intent_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare job_id uuid;
begin
  if p_reason not in ('expired_unfinalized','abandoned_finalized','validation_failed','session_delete') then raise exception 'invalid_cleanup_reason'; end if;
  insert into public.upload_cleanup_jobs(upload_intent_id,reason,status,available_at)
  values(p_upload_intent_id,p_reason,'queued',clock_timestamp()) on conflict(upload_intent_id) do update
    set reason=excluded.reason,status=case when upload_cleanup_jobs.status='completed' then upload_cleanup_jobs.status else 'queued' end,
        available_at=least(upload_cleanup_jobs.available_at,excluded.available_at),updated_at=clock_timestamp()
  returning id into job_id;
  return job_id;
end $$;

create or replace function public.acttub_observe_upload_object(p_upload_intent_id uuid,p_user_id uuid,p_actual_size_bytes bigint,p_actual_mime_type text)
returns text language plpgsql security definer set search_path=public as $$
declare u public.upload_intents%rowtype; policy public.upload_quota_policy%rowtype; active_bytes numeric; outcome text; authoritative_size bigint;
begin
  if p_actual_size_bytes not between 1 and 576716800 then raise exception 'invalid_media_metadata'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  select * into u from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id for update;
  if not found or u.consumed_at is not null or u.cleanup_completed_at is not null then raise exception 'upload_intent_invalid'; end if;
  authoritative_size:=greatest(coalesce(u.actual_size_bytes,p_actual_size_bytes),p_actual_size_bytes);
  update public.upload_intents set actual_size_bytes=authoritative_size,updated_at=clock_timestamp() where id=u.id;
  select * into strict policy from public.upload_quota_policy where singleton;
  select coalesce(sum(coalesce(actual_size_bytes,expected_size_bytes)),0) into active_bytes from public.upload_intents where user_id=p_user_id and consumed_at is null and cleanup_completed_at is null;
  outcome:=case when u.actual_size_bytes is not null and u.actual_size_bytes<>p_actual_size_bytes then 'source_video_metadata_invalid'
    when active_bytes>policy.max_active_bytes then 'upload_quota_exceeded'
    when p_actual_size_bytes<>u.expected_size_bytes or p_actual_mime_type is distinct from u.expected_mime_type then 'source_video_metadata_invalid' else 'ok' end;
  if outcome<>'ok' then
    update public.upload_intents set status='validation_failed',updated_at=clock_timestamp() where id=u.id;
    perform public.acttub_enqueue_upload_cleanup(u.id,'validation_failed');
  end if;
  return outcome;
end $$;

create or replace function public.acttub_cleanup_protected(p_upload_intent_id uuid,p_reason text)
returns boolean language sql stable security definer set search_path=public as $$
  select case when p_reason='validation_failed' then
    not exists(select 1 from public.practice_sessions s join public.practice_upstream_operations o on (o.session_id,o.user_id)=(s.id,s.user_id)
      where s.upload_intent_id=p_upload_intent_id and o.status in ('queued','in_flight'))
    and (
      (not exists(select 1 from public.practice_sessions s where s.upload_intent_id=p_upload_intent_id)
       and not exists(select 1 from public.practice_takes t join public.upload_intents u on u.expected_storage_path=t.storage_path where u.id=p_upload_intent_id))
      or exists(select 1 from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
        where s.upload_intent_id=p_upload_intent_id and t.analysis_status='failed' and not coalesce(t.analysis_retryable,false))
    )
  else not exists(select 1 from public.practice_sessions s where s.upload_intent_id=p_upload_intent_id)
    and not exists(select 1 from public.practice_takes t join public.upload_intents u on u.expected_storage_path=t.storage_path where u.id=p_upload_intent_id)
  end
$$;

create or replace function public.acttub_claim_upload_cleanup_job(p_upload_intent_id uuid,p_lease_token uuid,p_lease_seconds integer,p_worker_id text default null)
returns table(id uuid,upload_intent_id uuid,lease_token uuid,reason text,attempt_count integer,storage_bucket text,storage_path text,observed_size_bytes bigint)
language plpgsql security definer set search_path=public as $$
declare owner_id uuid; u public.upload_intents%rowtype; j public.upload_cleanup_jobs%rowtype; policy public.upload_quota_policy%rowtype;
begin
  if p_lease_seconds not between 30 and 300 then raise exception 'invalid_cleanup_claim'; end if;
  select user_id into owner_id from public.upload_intents where upload_intents.id=p_upload_intent_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||owner_id::text,0));
  select * into u from public.upload_intents where upload_intents.id=p_upload_intent_id and consumed_at is null and cleanup_completed_at is null for update skip locked;
  if not found then return; end if;
  select * into j from public.upload_cleanup_jobs where upload_cleanup_jobs.upload_intent_id=u.id for update skip locked;
  if not found or j.status='completed' or not ((j.status in ('queued','failed') and j.available_at<=clock_timestamp()) or (j.status='in_flight' and j.lease_expires_at<=clock_timestamp())) then return; end if;
  select * into strict policy from public.upload_quota_policy where singleton;
  if (j.reason='expired_unfinalized' and not (u.status in ('created','expired','cleanup_failed') and u.expires_at+policy.created_or_finalized_grace<=clock_timestamp()))
    or (j.reason='abandoned_finalized' and not (u.status in ('validating','finalized','cleanup_failed') and u.expires_at+policy.created_or_finalized_grace<=clock_timestamp()))
    or (j.reason='validation_failed' and u.status not in ('validation_failed','cleanup_failed')) then return; end if;
  if not public.acttub_cleanup_protected(u.id,j.reason) then return; end if;
  update public.upload_intents set status='cleanup_failed',updated_at=clock_timestamp() where upload_intents.id=u.id;
  update public.upload_cleanup_jobs set status='in_flight',lease_token=p_lease_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),worker_id=p_worker_id,
    attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),completed_at=null where upload_cleanup_jobs.id=j.id returning * into j;
  return query select j.id,u.id,p_lease_token,j.reason,j.attempt_count,u.expected_storage_bucket,u.expected_storage_path,u.actual_size_bytes;
end $$;

create or replace function public.acttub_claim_upload_cleanup_jobs(p_lease_token uuid,p_lease_seconds integer,p_batch_size integer,p_worker_id text default null)
returns table(id uuid,upload_intent_id uuid,lease_token uuid,reason text,attempt_count integer,storage_bucket text,storage_path text,observed_size_bytes bigint)
language plpgsql security definer set search_path=public as $$
declare policy public.upload_quota_policy%rowtype; hint record; claimed record; claimed_count integer:=0;
begin
  if p_lease_seconds not between 30 and 1800 or p_batch_size not between 1 and 50 then raise exception 'invalid_cleanup_claim'; end if;
  select * into strict policy from public.upload_quota_policy where singleton;
  for hint in
    select u.id,u.user_id,case when u.status='validation_failed' then 'validation_failed' when u.status in ('validating','finalized') then 'abandoned_finalized' else 'expired_unfinalized' end reason
    from public.upload_intents u where u.consumed_at is null and u.cleanup_completed_at is null and (
      (u.status in ('created','expired') and u.expires_at+policy.created_or_finalized_grace<=clock_timestamp()) or
      (u.status in ('validating','finalized') and u.expires_at+policy.created_or_finalized_grace<=clock_timestamp()) or
      (u.status='validation_failed' and u.updated_at+policy.validation_failed_grace<=clock_timestamp()))
    union
    select u.id,u.user_id,j.reason from public.upload_cleanup_jobs j join public.upload_intents u on u.id=j.upload_intent_id
      where (j.status in ('queued','failed') and j.available_at<=clock_timestamp()) or (j.status='in_flight' and j.lease_expires_at<=clock_timestamp())
    order by 1 limit p_batch_size*4
  loop
    exit when claimed_count>=p_batch_size;
    if not exists(select 1 from public.upload_cleanup_jobs existing_job where existing_job.upload_intent_id=hint.id) then
      perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||hint.user_id::text,0));
      perform 1 from public.upload_intents hinted_intent where hinted_intent.id=hint.id and hinted_intent.consumed_at is null and hinted_intent.cleanup_completed_at is null for update;
      if found and public.acttub_cleanup_protected(hint.id,hint.reason) then perform public.acttub_enqueue_upload_cleanup(hint.id,hint.reason); end if;
    end if;
    for claimed in select * from public.acttub_claim_upload_cleanup_job(hint.id,p_lease_token,least(p_lease_seconds,300),p_worker_id) loop
      claimed_count:=claimed_count+1;
      return query select claimed.id,claimed.upload_intent_id,claimed.lease_token,claimed.reason,claimed.attempt_count,claimed.storage_bucket,claimed.storage_path,claimed.observed_size_bytes;
    end loop;
  end loop;
end $$;

create or replace function public.acttub_record_upload_cleanup_observation(p_job_id uuid,p_lease_token uuid,p_actual_size_bytes bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare owner_id uuid; upload_id uuid; prior_size bigint;
begin
  if p_actual_size_bytes not between 1 and 576716800 then raise exception 'invalid_media_metadata'; end if;
  select u.user_id,u.id into owner_id,upload_id from public.upload_cleanup_jobs j join public.upload_intents u on u.id=j.upload_intent_id where j.id=p_job_id;
  if not found then raise exception 'stale_cleanup_lease'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||owner_id::text,0));
  select actual_size_bytes into prior_size from public.upload_intents where id=upload_id for update;
  if prior_size is not null and prior_size<>p_actual_size_bytes then raise exception 'storage_object_changed' using errcode='P0001'; end if;
  perform 1 from public.upload_cleanup_jobs where id=p_job_id and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_cleanup_lease' using errcode='P0001'; end if;
  update public.upload_intents set actual_size_bytes=p_actual_size_bytes,updated_at=clock_timestamp() where id=upload_id;
  update public.upload_cleanup_jobs set observed_size_bytes=p_actual_size_bytes,updated_at=clock_timestamp() where id=p_job_id;
  return true;
end $$;

create or replace function public.acttub_complete_upload_cleanup(p_job_id uuid,p_lease_token uuid,p_object_existed boolean,p_cleaned_size_bytes bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare job public.upload_cleanup_jobs%rowtype; owner_id uuid; upload_id uuid;
begin
  select u.user_id,u.id into owner_id,upload_id from public.upload_cleanup_jobs j join public.upload_intents u on u.id=j.upload_intent_id where j.id=p_job_id;
  if owner_id is null then raise exception 'stale_cleanup_lease' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||owner_id::text,0));
  perform 1 from public.upload_intents where id=upload_id and consumed_at is null and cleanup_completed_at is null for update;
  if not found then raise exception 'cleanup_protection_changed' using errcode='P0001'; end if;
  select * into job from public.upload_cleanup_jobs where id=p_job_id and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_cleanup_lease' using errcode='P0001'; end if;
  if not public.acttub_cleanup_protected(upload_id,job.reason) then
    update public.upload_cleanup_jobs set status='failed',lease_token=null,lease_expires_at=null,worker_id=null,safe_error_code='worker_crash',available_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_job_id;
    return false;
  end if;
  update public.upload_cleanup_jobs set status='completed',lease_token=null,lease_expires_at=null,worker_id=null,object_existed=p_object_existed,
    cleaned_size_bytes=p_cleaned_size_bytes,safe_error_code=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_job_id;
  update public.upload_intents u set status='expired',cleanup_completed_at=clock_timestamp(),updated_at=clock_timestamp() where u.id=job.upload_intent_id and u.consumed_at is null
    and ((not exists(select 1 from public.practice_sessions s where s.upload_intent_id=u.id)
      and not exists(select 1 from public.practice_takes t where t.storage_path=u.expected_storage_path))
      or (u.status in ('validation_failed','cleanup_failed') and exists(select 1 from public.practice_sessions s join public.practice_takes t on (t.session_id,t.user_id)=(s.id,s.user_id)
        where s.upload_intent_id=u.id and t.analysis_status='failed' and not coalesce(t.analysis_retryable,false))));
  return true;
end $$;

create or replace function public.acttub_fail_upload_cleanup(p_job_id uuid,p_lease_token uuid,p_safe_error_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare job public.upload_cleanup_jobs%rowtype; owner_id uuid; upload_id uuid;
begin
  if p_safe_error_code not in ('storage_delete_failed','storage_inspection_failed','storage_object_changed','invalid_cleanup_object','worker_crash','timeout') then p_safe_error_code:='storage_delete_failed'; end if;
  select u.user_id,u.id into owner_id,upload_id from public.upload_cleanup_jobs j join public.upload_intents u on u.id=j.upload_intent_id where j.id=p_job_id;
  if not found then raise exception 'stale_cleanup_lease'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||owner_id::text,0));
  perform 1 from public.upload_intents where id=upload_id for update;
  select * into job from public.upload_cleanup_jobs where id=p_job_id and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_cleanup_lease' using errcode='P0001'; end if;
  update public.upload_cleanup_jobs set status='failed',lease_token=null,lease_expires_at=null,worker_id=null,safe_error_code=p_safe_error_code,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,5*(2^least(attempt_count,9))::integer)),updated_at=clock_timestamp() where id=p_job_id;
  update public.upload_intents set status='cleanup_failed',updated_at=clock_timestamp() where id=job.upload_intent_id and consumed_at is null;
  return true;
end $$;

create or replace function public.acttub_record_trusted_media_probe_v2(
 p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_authoritative_duration_ms integer,p_media_metadata_version text,p_actual_size_bytes bigint
) returns text language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; u public.upload_intents%rowtype; t public.practice_takes%rowtype; policy public.upload_quota_policy%rowtype; active_bytes numeric; authoritative_size bigint;
begin
  if p_authoritative_duration_ms not between 1 and 180000 or p_media_metadata_version<>'iso-bmff-duration.v1' or p_actual_size_bytes not between 1 and 576716800 then raise exception 'invalid_media_metadata'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  select upload.* into u from public.upload_intents upload join public.practice_sessions s on s.upload_intent_id=upload.id where s.id=p_session_id and s.user_id=p_user_id;
  if not found then raise exception 'upload_intent_invalid'; end if;
  select * into u from public.upload_intents upload where upload.id=u.id for update;
  select * into job from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  select * into t from public.practice_takes where session_id=p_session_id and user_id=p_user_id for update;
  authoritative_size:=greatest(coalesce(u.actual_size_bytes,p_actual_size_bytes),p_actual_size_bytes);
  update public.upload_intents set actual_size_bytes=authoritative_size,updated_at=clock_timestamp() where id=u.id;
  select * into strict policy from public.upload_quota_policy where singleton;
  select coalesce(sum(coalesce(actual_size_bytes,expected_size_bytes)),0) into active_bytes from public.upload_intents where user_id=p_user_id and consumed_at is null and cleanup_completed_at is null;
  if (u.actual_size_bytes is not null and u.actual_size_bytes<>p_actual_size_bytes) or p_actual_size_bytes<>u.expected_size_bytes or active_bytes>policy.max_active_bytes then
    update public.upload_intents set status='validation_failed',ai_eligible_at=null,finalized_at=null,consumed_at=null,updated_at=clock_timestamp() where id=u.id;
    update public.practice_takes set analysis_status='failed',analysis_error=case when active_bytes>policy.max_active_bytes then 'upload_quota_exceeded' else 'source_video_metadata_invalid' end,analysis_retryable=false where id=t.id;
    update public.practice_upstream_operations set status='failed',safe_error_code=case when active_bytes>policy.max_active_bytes then 'upload_quota_exceeded' else 'source_video_metadata_invalid' end,lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=job.id;
    perform public.acttub_enqueue_upload_cleanup(u.id,'validation_failed');
    return case when active_bytes>policy.max_active_bytes then 'upload_quota_exceeded' else 'source_video_metadata_invalid' end;
  end if;
  update public.upload_intents set duration_ms=p_authoritative_duration_ms,authoritative_duration_ms=p_authoritative_duration_ms,media_metadata_version=p_media_metadata_version,
    ai_eligible_at=clock_timestamp(),status='finalized',finalized_at=clock_timestamp(),updated_at=clock_timestamp() where id=u.id;
  update public.practice_takes set duration_ms=p_authoritative_duration_ms,media_metadata_version=p_media_metadata_version,size_bytes=p_actual_size_bytes where id=t.id;
  return 'ok';
end $$;

create or replace function public.acttub_finalize_upload_intent(
  p_upload_intent_id uuid,p_user_id uuid,p_storage_path text,p_duration_ms integer
) returns table(upload_intent_id uuid,session_id uuid,duration_ms integer)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype;
begin
  if p_duration_ms not between 1 and 180000 then raise exception 'invalid_duration'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id for update;
  if not found or v.expected_storage_path<>p_storage_path then raise exception 'upload_intent_invalid'; end if;
  if v.status in ('validating','finalized') and coalesce(v.reported_duration_ms,v.duration_ms)=p_duration_ms then
    return query select v.id,v.session_id,p_duration_ms; return;
  end if;
  if v.expires_at<=clock_timestamp() or v.consumed_at is not null or v.cleanup_completed_at is not null then raise exception 'upload_intent_invalid'; end if;
  if v.status<>'created' then raise exception 'upload_intent_invalid'; end if;
  update public.upload_intents set status='validating',reported_duration_ms=p_duration_ms,
    duration_ms=null,authoritative_duration_ms=null,media_metadata_version=null,
    ai_eligible_at=null,finalized_at=null,updated_at=clock_timestamp() where id=v.id;
  return query select v.id,v.session_id,p_duration_ms;
end $$;

create or replace function public.acttub_enqueue_acting_session(
  p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_request_id uuid,
  p_request_fingerprint text,p_operation_id uuid,p_medium text,p_genre text,
  p_situation text,p_character_context text,p_subtext text,p_created_at timestamptz default now()
) returns table(operation_id uuid,claim_state text,session_id uuid)
language plpgsql security definer set search_path=public as $$
declare v public.upload_intents%rowtype; replay record; report integer;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('acttub-session:'||p_session_id::text,0));
  select * into replay from public.acttub_operation_claim_state(p_user_id,p_request_id,p_request_fingerprint);
  if replay.found then return query select replay.operation_id,replay.claim_state,replay.session_id; return; end if;
  if exists(select 1 from public.practice_upstream_operations operation where operation.session_id=p_session_id and operation.user_id=p_user_id
      and operation.kind in ('analysis_create','analysis_retry') and operation.status in ('queued','in_flight')) then raise exception 'operation_in_progress'; end if;
  select * into v from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id
    and status in ('validating','finalized') and expires_at>clock_timestamp() and actual_size_bytes is not null
    and consumed_at is null and cleanup_completed_at is null for update;
  report:=coalesce(v.reported_duration_ms,v.duration_ms);
  if not found or v.session_id<>p_session_id or report is null or report not between 1 and 180000 then raise exception 'upload_intent_invalid'; end if;
  update public.upload_intents set consumed_at=p_created_at,updated_at=clock_timestamp() where id=v.id;
  insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at)
    values(p_session_id,p_user_id,p_upload_intent_id,'analyzing','acting-api-v1',p_medium,p_genre,p_situation,p_character_context,p_subtext,p_created_at,p_created_at);
  insert into public.practice_takes(id,session_id,user_id,storage_bucket,storage_path,mime_type,size_bytes,duration_ms,reported_duration_ms,analysis_status,created_at)
    values(p_take_id,p_session_id,p_user_id,v.expected_storage_bucket,v.expected_storage_path,v.expected_mime_type,v.actual_size_bytes,null,report,'pending',p_created_at);
  insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status,lease_token,lease_expires_at,started_at,available_at)
    values(p_operation_id,p_session_id,p_user_id,p_request_id,p_request_fingerprint,'analysis_create','queued',null,null,clock_timestamp(),clock_timestamp());
  return query select p_operation_id,'claimed',p_session_id;
end $$;

create or replace function public.acttub_fail_trusted_media_validation(p_session_id uuid,p_user_id uuid,p_operation_id uuid,p_lease_token uuid,p_safe_error_code text)
returns void language plpgsql security definer set search_path=public as $$
declare job public.practice_upstream_operations%rowtype; upload_id uuid;
begin
  if p_safe_error_code not in ('video_too_long','source_video_metadata_invalid') then raise exception 'invalid_media_failure'; end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
  select upload_intent_id into upload_id from public.practice_sessions where id=p_session_id and user_id=p_user_id;
  if not found then raise exception 'upload_intent_invalid'; end if;
  perform 1 from public.upload_intents where id=upload_id for update;
  select * into job from public.practice_upstream_operations where id=p_operation_id and session_id=p_session_id and user_id=p_user_id and status='in_flight' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'stale_analysis_lease'; end if;
  perform 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id for update;
  update public.upload_intents set status='validation_failed',duration_ms=null,authoritative_duration_ms=null,media_metadata_version=null,ai_eligible_at=null,finalized_at=null,consumed_at=null,updated_at=clock_timestamp() where id=upload_id;
  update public.practice_takes set duration_ms=null,media_metadata_version=null,analysis_status='failed',analysis_error=p_safe_error_code,analysis_retryable=false where session_id=p_session_id and user_id=p_user_id;
  update public.practice_upstream_operations set status='failed',safe_error_code=p_safe_error_code,response_payload=public.acttub_error_replay_payload('analysis','definitive',p_safe_error_code,null),lease_token=null,lease_expires_at=null,finished_at=clock_timestamp() where id=job.id;
  perform public.acttub_enqueue_upload_cleanup(upload_id,'validation_failed');
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
  if char_length(p_situation) > 2000
    or char_length(p_character_context) > 2000
    or char_length(coalesce(p_subtext, '')) > 2000
    or char_length(p_situation)
      + char_length(p_character_context)
      + char_length(coalesce(p_subtext, '')) > 4000
  then
    raise exception 'practice_scene_context_too_large' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:' || p_user_id::text, 0));

  select * into v_upload_intent
  from public.upload_intents ui
  where ui.id = p_upload_intent_id
    and ui.user_id = p_user_id
    and ui.session_id = p_session_id
    and ui.status = 'created'
    and ui.expires_at > now()
    and ui.consumed_at is null
    and ui.cleanup_completed_at is null
  for update;

  if not found then
    raise exception 'Upload intent is not available for atomic session creation.'
      using errcode = 'P0001';
  end if;

  update public.upload_intents
  set status = 'finalized',
      consumed_at = p_created_at,
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


create or replace function public.acttub_create_pipeline_session(p_upload_intent_id uuid,p_user_id uuid,p_session_id uuid,p_take_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$ declare u public.upload_intents; begin
 perform pg_advisory_xact_lock(hashtextextended('acttub-upload-quota:'||p_user_id::text,0));
 if exists(select 1 from public.practice_sessions where id=p_session_id and user_id=p_user_id and upload_intent_id=p_upload_intent_id) then return (select jsonb_build_object('session_id',p_session_id,'take_id',t.id) from public.practice_takes t where t.session_id=p_session_id and t.user_id=p_user_id order by t.created_at limit 1); end if;
 select * into u from public.upload_intents where id=p_upload_intent_id and user_id=p_user_id and status='finalized' and ai_eligible_at is not null and authoritative_duration_ms between 1 and 300000 and media_metadata_version='iso-bmff-duration.v1' and consumed_at is null and cleanup_completed_at is null and required_consent_version_snapshot=public.current_acttub_terms_version() and ai_processing_consent_version_snapshot=public.current_acttub_ai_processing_consent_version() and exists(select 1 from public.profiles p where p.id=p_user_id and p.status='active' and p.required_consent_version=public.current_acttub_terms_version() and p.required_consent_at is not null and p.ai_processing_consent_version=public.current_acttub_ai_processing_consent_version() and p.ai_processing_consent_at is not null) for update; if not found then raise exception 'upload_not_ai_eligible'; end if;
 if u.session_id<>p_session_id then raise exception 'idempotency_conflict'; end if;
 update public.upload_intents set consumed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_upload_intent_id;
 insert into public.practice_sessions(id,user_id,upload_intent_id,status,medium,genre,situation,character_context,subtext,pipeline_version,required_consent_version_snapshot,ai_processing_consent_version_snapshot,adult_confirmed_at,all_participants_confirmed_at,interview_status,substantive_answer_count)
 values(p_session_id,p_user_id,p_upload_intent_id,'observations_pending',coalesce(p_payload->>'medium','upload_url'),p_payload->>'genre',p_payload->>'situation',p_payload->>'characterContext',p_payload->>'subtext','ai-pipeline.v1',u.required_consent_version_snapshot,u.ai_processing_consent_version_snapshot,u.adult_confirmed_at,u.all_participants_confirmed_at,'active',0);
 insert into public.practice_takes(id,session_id,user_id,storage_bucket,storage_path,mime_type,size_bytes,duration_ms,media_metadata_version,analysis_status) values(p_take_id,p_session_id,p_user_id,u.expected_storage_bucket,u.expected_storage_path,u.expected_mime_type,coalesce(u.actual_size_bytes,u.expected_size_bytes),u.authoritative_duration_ms,u.media_metadata_version,'generated');
 return jsonb_build_object('session_id',p_session_id,'take_id',p_take_id); end $$;

create or replace function public.acttub_purge_upload_cleanup_tombstones(p_batch_size integer default 100)
returns bigint language plpgsql security definer set search_path=public as $$
declare purged bigint;
begin
  if p_batch_size not between 1 and 500 then raise exception 'invalid_cleanup_purge'; end if;
  with candidates as (
    select u.id from public.upload_cleanup_jobs j
    join public.upload_intents u on u.id=j.upload_intent_id
    cross join public.upload_quota_policy p
    where p.singleton and j.status='completed' and j.completed_at<=clock_timestamp()-p.completed_tombstone_retention
      and u.cleanup_completed_at is not null
      and not exists(select 1 from public.practice_sessions s where s.upload_intent_id=u.id)
      and not exists(select 1 from public.practice_takes t where t.storage_path=u.expected_storage_path)
    order by j.completed_at,j.id
    for update of j skip locked limit p_batch_size
  ), deleted as (
    delete from public.upload_intents u using candidates c where u.id=c.id
      and u.cleanup_completed_at is not null
      and not exists(select 1 from public.practice_sessions s where s.upload_intent_id=u.id)
      and not exists(select 1 from public.practice_takes t where t.storage_path=u.expected_storage_path)
    returning u.id
  ) select count(*) into purged from deleted;
  return purged;
end $$;

revoke all on function public.acttub_upload_quota_guard() from public,anon,authenticated;
revoke all on function public.acttub_enqueue_upload_cleanup(uuid,text) from public,anon,authenticated;
revoke all on function public.acttub_cleanup_protected(uuid,text) from public,anon,authenticated;
revoke all on function public.acttub_observe_upload_object(uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.acttub_claim_upload_cleanup_jobs(uuid,integer,integer,text) from public,anon,authenticated;
revoke all on function public.acttub_claim_upload_cleanup_job(uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.acttub_complete_upload_cleanup(uuid,uuid,boolean,bigint) from public,anon,authenticated;
revoke all on function public.acttub_fail_upload_cleanup(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.acttub_record_trusted_media_probe_v2(uuid,uuid,uuid,uuid,integer,text,bigint) from public,anon,authenticated;
revoke all on function public.acttub_record_upload_cleanup_observation(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.acttub_purge_upload_cleanup_tombstones(integer) from public,anon,authenticated;
grant execute on function public.acttub_claim_upload_cleanup_jobs(uuid,integer,integer,text) to service_role;
grant execute on function public.acttub_claim_upload_cleanup_job(uuid,uuid,integer,text) to service_role;
grant execute on function public.acttub_observe_upload_object(uuid,uuid,bigint,text) to service_role;
grant execute on function public.acttub_complete_upload_cleanup(uuid,uuid,boolean,bigint) to service_role;
grant execute on function public.acttub_fail_upload_cleanup(uuid,uuid,text) to service_role;
grant execute on function public.acttub_record_trusted_media_probe_v2(uuid,uuid,uuid,uuid,integer,text,bigint) to service_role;
grant execute on function public.acttub_record_upload_cleanup_observation(uuid,uuid,bigint) to service_role;
grant execute on function public.acttub_purge_upload_cleanup_tombstones(integer) to service_role;
notify pgrst,'reload schema';
