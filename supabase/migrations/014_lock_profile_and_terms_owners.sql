-- Make profile creation and consent transitions server-owned.
-- Preserve OAuth pending-profile creation and active re-consent while ensuring
-- a suspended profile cannot be partially mutated or reactivated.

begin;

drop policy if exists "profiles owner insert self" on public.profiles;
drop policy if exists "profiles owner update terms" on public.profiles;

revoke insert, update on table public.profiles from authenticated;

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
begin
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
    required_consent_version = p_required_consent_version,
    required_consent_at = p_accepted_at,
    ai_processing_consent_version = p_ai_processing_consent_version,
    ai_processing_consent_at = p_accepted_at,
    internal_review_consent = p_internal_review_consent,
    internal_review_consent_updated_at = p_accepted_at,
    terms_accepted_at = p_accepted_at,
    privacy_accepted_at = p_accepted_at,
    internal_review_consent_at = case when p_internal_review_consent then p_accepted_at else null end,
    consent_version = p_required_consent_version,
    updated_at = p_accepted_at
  where id = p_user_id;
end;
$$;

revoke execute on function public.acttub_accept_terms(uuid, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.acttub_accept_terms(uuid, text, text, boolean, timestamptz)
  to service_role;

commit;
