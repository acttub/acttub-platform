-- Align profile consent with the deployed required + AI-processing contract.
-- Internal review remains optional and must never gate normal product access.

begin;

create or replace function public.current_acttub_ai_processing_consent_version()
returns text
language sql
immutable
set search_path = public
as $$
  select 'ai-processing.v1'::text;
$$;

alter table public.profiles
  add column if not exists required_consent_version text,
  add column if not exists required_consent_at timestamptz,
  add column if not exists ai_processing_consent_version text,
  add column if not exists ai_processing_consent_at timestamptz,
  add column if not exists internal_review_consent boolean not null default false,
  add column if not exists internal_review_consent_updated_at timestamptz;

alter table public.profiles
  drop constraint if exists active_profile_requires_current_consent;

alter table public.profiles
  add constraint active_profile_requires_current_consent check (
    status <> 'active'
    or (
      required_consent_version is not null
      and required_consent_at is not null
      and ai_processing_consent_version is not null
      and ai_processing_consent_at is not null
    )
  ) not valid;

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

revoke execute on function public.current_acttub_ai_processing_consent_version()
  from public, anon, authenticated;
grant execute on function public.current_acttub_ai_processing_consent_version()
  to service_role;

commit;
