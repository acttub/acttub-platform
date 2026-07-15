begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '10000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'consent-version-test@example.com',
  now(),
  now()
);

insert into public.profiles (id, email, status)
values (
  '10000000-0000-0000-0000-000000000001',
  'consent-version-test@example.com',
  'pending_terms'
);

select lives_ok(
  $$select public.acttub_accept_terms(
    '10000000-0000-0000-0000-000000000001',
    public.current_acttub_terms_version(),
    public.current_acttub_ai_processing_consent_version(),
    false
  )$$,
  'the consent transition accepts the database current versions'
);

select ok(
  public.is_active_acttub_profile('10000000-0000-0000-0000-000000000001'),
  'the profile gate accepts a profile with database current consent'
);

insert into public.upload_intents (
  id,
  user_id,
  session_id,
  expected_storage_path,
  expected_mime_type,
  expected_size_bytes
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000001/take.mp4',
    'video/mp4',
    1024
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000002/take.mp4',
    'video/mp4',
    1024
  );

select is(
  (select consent_version from public.upload_intents where id = '20000000-0000-0000-0000-000000000001'),
  public.current_acttub_terms_version(),
  'an omitted upload-intent consent snapshot uses the database default'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'practice-videos',
      'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000001/take.mp4',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  'Storage RLS accepts the current profile and current intent snapshot'
);

reset role;

create or replace function public.current_acttub_terms_version()
returns text
language sql
stable
set search_path = public
as $$
  select 'db-test-next-version'::text;
$$;

select ok(
  not public.is_active_acttub_profile('10000000-0000-0000-0000-000000000001'),
  'the profile gate rejects consent from the previous database version'
);

select throws_ok(
  $$select public.acttub_accept_terms(
    '10000000-0000-0000-0000-000000000001',
    'stale-env-version',
    public.current_acttub_ai_processing_consent_version(),
    false
  )$$,
  'P0001',
  'consent_version_mismatch',
  'a stale environment version cannot authorize a consent transition'
);

select lives_ok(
  $$select public.acttub_accept_terms(
    '10000000-0000-0000-0000-000000000001',
    public.current_acttub_terms_version(),
    public.current_acttub_ai_processing_consent_version(),
    false
  )$$,
  're-consent succeeds with the new database current version'
);

select ok(
  public.is_active_acttub_profile('10000000-0000-0000-0000-000000000001'),
  'the profile gate accepts the re-consented profile'
);

insert into public.upload_intents (
  id,
  user_id,
  session_id,
  expected_storage_path,
  expected_mime_type,
  expected_size_bytes
)
values (
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000003/take.mp4',
  'video/mp4',
  1024
);

select is(
  (select consent_version from public.upload_intents where id = '20000000-0000-0000-0000-000000000003'),
  'db-test-next-version',
  'new upload intents snapshot the changed database version despite stale application env'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'practice-videos',
      'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000002/take.mp4',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'Storage RLS rejects an intent snapshot from the previous version'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'practice-videos',
      'users/10000000-0000-0000-0000-000000000001/practice-sessions/30000000-0000-0000-0000-000000000003/take.mp4',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  'Storage RLS accepts the new database-canonical intent snapshot'
);

reset role;

select * from finish();

rollback;
