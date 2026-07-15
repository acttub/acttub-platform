begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '16000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'practice-input-limit-test@example.com',
  now(),
  now()
);

insert into public.profiles (id, email, status)
values (
  '16000000-0000-0000-0000-000000000001',
  'practice-input-limit-test@example.com',
  'pending_terms'
);

insert into public.upload_intents (
  id,
  user_id,
  session_id,
  status,
  expected_storage_path,
  expected_mime_type,
  expected_size_bytes,
  duration_ms,
  finalized_at
)
select
  ('16000000-0000-0000-0001-' || lpad(value::text, 12, '0'))::uuid,
  '16000000-0000-0000-0000-000000000001'::uuid,
  ('16000000-0000-0000-0002-' || lpad(value::text, 12, '0'))::uuid,
  'finalized',
  'users/16000000-0000-0000-0000-000000000001/practice-sessions/' ||
    ('16000000-0000-0000-0002-' || lpad(value::text, 12, '0')) || '/take.mp4',
  'video/mp4',
  1024,
  1000,
  now()
from generate_series(1, 5) as value;

select lives_ok(
  $$insert into public.practice_sessions (
      id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
      situation, character_context, subtext
    ) values (
      '16000000-0000-0000-0002-000000000001',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0001-000000000001',
      'observations_pending', 'legacy-gemini-v1', '기타', '기타',
      repeat('가', 2000), repeat('나', 1999), '다'
    )$$,
  'database accepts 2,000 per scene field and 4,000 in aggregate'
);

select throws_like(
  $$insert into public.practice_sessions (
      id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
      situation, character_context, subtext
    ) values (
      '16000000-0000-0000-0002-000000000002',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0001-000000000002',
      'observations_pending', 'legacy-gemini-v1', '기타', '기타',
      repeat('😀', 2001), '인물', '의도'
    )$$,
  '%practice_scene_context%',
  'database rejects a 2,001-code-point scene field'
);

select throws_like(
  $$insert into public.practice_sessions (
      id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
      situation, character_context, subtext
    ) values (
      '16000000-0000-0000-0002-000000000003',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0001-000000000003',
      'observations_pending', 'legacy-gemini-v1', '기타', '기타',
      repeat('가', 2000), repeat('나', 2000), '다'
    )$$,
  '%practice_scene_context%',
  'database rejects a 4,001-code-point scene aggregate'
);

select throws_ok(
  $$select public.acttub_create_acting_session(
    '16000000-0000-0000-0001-000000000005',
    '16000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0002-000000000005',
    '16000000-0000-0000-0003-000000000001',
    '16000000-0000-0000-0004-000000000001',
    repeat('a', 64),
    '16000000-0000-0000-0005-000000000001',
    '16000000-0000-0000-0006-000000000001',
    '기타', '기타', repeat('😀', 2001), '인물', '의도', 780
  )$$,
  'P0001',
  'practice_scene_context_too_large',
  'direct security-definer create RPC rejects oversized scene context before claiming'
);

insert into public.practice_sessions (
  id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
  situation, character_context, subtext
) values (
  '16000000-0000-0000-0002-000000000004',
  '16000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0001-000000000004',
  'interview', 'acting-api-v1', '기타', '기타', '상황', '인물', '의도'
);

insert into public.practice_interview_runs (
  id, session_id, user_id, status, start_mode, acting_session_id
) values (
  '16000000-0000-0000-0007-000000000001',
  '16000000-0000-0000-0002-000000000004',
  '16000000-0000-0000-0000-000000000001',
  'live', 'initial', 'acting-session-for-input-limit-test'
);

select lives_ok(
  $$insert into public.practice_turns (
      id, session_id, user_id, run_id, ordinal, role, delivery_status, request_id, text
    ) values (
      '16000000-0000-0000-0008-000000000001',
      '16000000-0000-0000-0002-000000000004',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0007-000000000001',
      1, 'actor', 'completed', '16000000-0000-0000-0009-000000000001',
      repeat('😀', 2000)
    )$$,
  'database accepts an actor reply of exactly 2,000 code points'
);

select throws_like(
  $$insert into public.practice_turns (
      id, session_id, user_id, run_id, ordinal, role, delivery_status, request_id, text
    ) values (
      '16000000-0000-0000-0008-000000000002',
      '16000000-0000-0000-0002-000000000004',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0007-000000000001',
      2, 'actor', 'completed', '16000000-0000-0000-0009-000000000002',
      repeat('😀', 2001)
    )$$,
  '%practice_reply%',
  'database rejects an actor reply of 2,001 code points'
);

select lives_ok(
  $$insert into public.practice_turns (
      id, session_id, user_id, run_id, ordinal, role, delivery_status, text
    ) values (
      '16000000-0000-0000-0008-000000000003',
      '16000000-0000-0000-0002-000000000004',
      '16000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0007-000000000001',
      3, 'ai', 'completed', repeat('가', 2001)
    )$$,
  'the actor-only reply limit does not truncate AI turns'
);

select throws_ok(
  $$select public.acttub_claim_coach_reply(
    '16000000-0000-0000-0002-000000000004',
    '16000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0007-000000000001',
    '16000000-0000-0000-0009-000000000004',
    repeat('b', 64),
    '16000000-0000-0000-0005-000000000004',
    '16000000-0000-0000-0008-000000000004',
    repeat('😀', 2001),
    null,
    '16000000-0000-0000-0006-000000000004',
    120
  )$$,
  'P0001',
  'practice_reply_too_large',
  'direct security-definer reply RPC rejects oversized text before claiming'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    join pg_class relation on relation.oid = constraint_record.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'practice_sessions'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_get_constraintdef(constraint_record.oid) ~* 'char_length.*situation.*2000'
  ),
  'scene limits are installed as validated table constraints after legacy remediation'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    join pg_class relation on relation.oid = constraint_record.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'practice_turns'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
      and pg_get_constraintdef(constraint_record.oid) ~* 'actor.*char_length.*2000'
  ),
  'reply limits are installed as validated table constraints after legacy remediation'
);

select is(
  (
    select count(*)
    from public.practice_sessions
    where user_id <> '16000000-0000-0000-0000-000000000001'
      and (
        char_length(situation) > 2000
        or char_length(character_context) > 2000
        or char_length(coalesce(subtext, '')) > 2000
        or char_length(situation) + char_length(character_context) + char_length(coalesce(subtext, '')) > 4000
      )
  ),
  0::bigint,
  'migration audit/remediation leaves no oversized legacy session rows before validation'
);

select * from finish();

rollback;
