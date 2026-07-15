-- Keep current consent authorization database-canonical across profile access,
-- consent acceptance, upload-intent snapshots, and private Storage uploads.

begin;

alter table public.upload_intents
  alter column consent_version set default public.current_acttub_terms_version();

create or replace function public.is_active_acttub_profile(profile_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = profile_user_id
      and p.status = 'active'
      and p.required_consent_version = public.current_acttub_terms_version()
      and p.required_consent_at is not null
      and p.ai_processing_consent_version = public.current_acttub_ai_processing_consent_version()
      and p.ai_processing_consent_at is not null
  );
$$;

create or replace function public.acttub_accept_terms(
  p_user_id uuid,
  p_required_consent_version text,
  p_ai_processing_consent_version text,
  p_internal_review_consent boolean,
  p_accepted_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_required_consent_version text := public.current_acttub_terms_version();
  v_ai_processing_consent_version text := public.current_acttub_ai_processing_consent_version();
begin
  if p_required_consent_version is distinct from v_required_consent_version
    or p_ai_processing_consent_version is distinct from v_ai_processing_consent_version then
    raise exception 'consent_version_mismatch' using errcode = 'P0001';
  end if;

  select status
  into v_status
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'suspended' then
    raise exception 'account_suspended' using errcode = 'PT403';
  end if;

  if v_status not in ('pending_terms', 'active') then
    raise exception 'invalid_profile_status' using errcode = 'P0001';
  end if;

  update public.profiles
  set
    status = 'active',
    required_consent_version = v_required_consent_version,
    required_consent_at = p_accepted_at,
    ai_processing_consent_version = v_ai_processing_consent_version,
    ai_processing_consent_at = p_accepted_at,
    internal_review_consent = p_internal_review_consent,
    internal_review_consent_updated_at = p_accepted_at,
    terms_accepted_at = p_accepted_at,
    privacy_accepted_at = p_accepted_at,
    internal_review_consent_at = case when p_internal_review_consent then p_accepted_at else null end,
    consent_version = v_required_consent_version,
    updated_at = p_accepted_at
  where id = p_user_id;
end;
$$;

revoke execute on function public.acttub_accept_terms(uuid, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.acttub_accept_terms(uuid, text, text, boolean, timestamptz)
  to service_role;

drop policy if exists "practice videos insert via active upload intent" on storage.objects;

create policy "practice videos insert via active upload intent"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'practice-videos'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'practice-sessions'
    and (storage.filename(name) in ('take.mp4', 'take.mov'))
    and public.is_active_acttub_profile(auth.uid())
    and exists (
      select 1
      from public.upload_intents ui
      where ui.user_id = auth.uid()
        and ui.status = 'created'
        and ui.consent_version = public.current_acttub_terms_version()
        and ui.expected_storage_bucket = storage.objects.bucket_id
        and ui.expected_storage_path = storage.objects.name
        and ui.expires_at > now()
    )
  );

commit;
