begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '17000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'retry-reply-actor-test@example.com',
  now(),
  now()
);

insert into public.profiles (id, email, status)
values (
  '17000000-0000-0000-0000-000000000001',
  'retry-reply-actor-test@example.com',
  'pending_terms'
);

insert into public.upload_intents (
  id, user_id, session_id, status, expected_storage_path, expected_mime_type,
  expected_size_bytes, duration_ms, finalized_at
)
select
  ('17000000-0000-0000-0001-' || lpad(value::text, 12, '0'))::uuid,
  '17000000-0000-0000-0000-000000000001'::uuid,
  ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0'))::uuid,
  'finalized',
  'users/17000000-0000-0000-0000-000000000001/practice-sessions/' ||
    ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0')) || '/take.mp4',
  'video/mp4',
  1024,
  1000,
  now()
from generate_series(1, 3) as value;

insert into public.practice_sessions (
  id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
  situation, character_context, subtext
)
select
  ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0'))::uuid,
  '17000000-0000-0000-0000-000000000001'::uuid,
  ('17000000-0000-0000-0001-' || lpad(value::text, 12, '0'))::uuid,
  'interview',
  'acting-api-v1',
  '기타',
  '기타',
  '상황',
  '인물',
  '의도'
from generate_series(1, 3) as value;

insert into public.practice_takes (
  id, session_id, user_id, storage_path, mime_type, size_bytes, duration_ms,
  analysis_status
)
select
  ('17000000-0000-0000-0003-' || lpad(value::text, 12, '0'))::uuid,
  ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0'))::uuid,
  '17000000-0000-0000-0000-000000000001'::uuid,
  'users/17000000-0000-0000-0000-000000000001/practice-sessions/' ||
    ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0')) || '/take.mp4',
  'video/mp4',
  1024,
  1000,
  'completed'
from generate_series(1, 3) as value;

insert into public.practice_interview_runs (
  id, session_id, user_id, acting_session_id, status, start_mode
)
select
  ('17000000-0000-0000-0004-' || lpad(value::text, 12, '0'))::uuid,
  ('17000000-0000-0000-0002-' || lpad(value::text, 12, '0'))::uuid,
  '17000000-0000-0000-0000-000000000001'::uuid,
  'acting-session-' || value,
  'live',
  case when value = 3 then 'restart' else 'initial' end
from generate_series(1, 3) as value;

update public.practice_sessions
set interview_run_id = ('17000000-0000-0000-0004-' || right(id::text, 12))::uuid;

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '17000000-0000-0000-0002-000000000001',
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0004-000000000001',
      '17000000-0000-0000-0005-000000000001',
      repeat('a', 64),
      '17000000-0000-0000-0006-000000000001',
      '17000000-0000-0000-0007-000000000001',
      '기존 배우 답변',
      null,
      '17000000-0000-0000-0008-000000000001',
      120
    )
  ),
  'claimed',
  'request A claims a new actor reply'
);

select is(
  (select request_id from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  '17000000-0000-0000-0005-000000000001'::uuid,
  'the initial actor row belongs to request A'
);

select lives_ok(
  $$select public.acttub_fail_coach_operation(
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    '17000000-0000-0000-0006-000000000001',
    '17000000-0000-0000-0008-000000000001',
    '17000000-0000-0000-0007-000000000001',
    'definitive',
    'acting_api_rate_limited'
  )$$,
  'request A can fail with a retryable actor delivery error'
);

select is(
  (select delivery_status from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  'failed',
  'request A leaves the actor row failed'
);

select is(
  (select delivery_retryable from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  true,
  'request A marks the actor row retryable'
);

select is(
  (
    select actor_turn_id
    from public.acttub_claim_coach_reply(
      '17000000-0000-0000-0002-000000000001',
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0004-000000000001',
      '17000000-0000-0000-0005-000000000002',
      repeat('b', 64),
      '17000000-0000-0000-0006-000000000002',
      '17000000-0000-0000-0007-000000000099',
      null,
      '17000000-0000-0000-0007-000000000001',
      '17000000-0000-0000-0008-000000000002',
      120
    )
  ),
  '17000000-0000-0000-0007-000000000001'::uuid,
  'request B reuses the exact actor row id'
);

select is(
  (select text from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  '기존 배우 답변',
  'request B preserves the stored actor text'
);

select is(
  (select request_id from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  '17000000-0000-0000-0005-000000000002'::uuid,
  'request B reconnects the actor row to the new request id'
);

select is(
  (select delivery_status from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  'pending',
  'request B resets the actor row to pending'
);

select is(
  (select delivery_error_code from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  null,
  'request B clears the previous delivery error'
);

select is(
  (select delivery_retryable from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  null,
  'request B clears the previous retryable flag'
);

select is(
  (select kind from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000002'),
  'coach_retry_reply',
  'request B creates a retry-reply operation'
);

select lives_ok(
  $$select public.acttub_complete_coach_turn(
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    '17000000-0000-0000-0006-000000000002',
    '17000000-0000-0000-0008-000000000002',
    'acting-session-1',
    '17000000-0000-0000-0009-000000000001',
    '다음 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'request B completes when exactly one pending actor matches'
);

select is(
  (select delivery_status from public.practice_turns where id = '17000000-0000-0000-0007-000000000001'),
  'completed',
  'request B completes the actor turn'
);

select is(
  (select delivery_status from public.practice_turns where id = '17000000-0000-0000-0009-000000000001'),
  'completed',
  'request B creates a completed AI turn'
);

select is(
  (select status from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000002'),
  'completed',
  'request B completes the operation'
);

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '17000000-0000-0000-0002-000000000001',
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0004-000000000001',
      '17000000-0000-0000-0005-000000000002',
      repeat('b', 64),
      '17000000-0000-0000-0006-000000000099',
      '17000000-0000-0000-0007-000000000099',
      null,
      '17000000-0000-0000-0007-000000000001',
      '17000000-0000-0000-0008-000000000099',
      120
    )
  ),
  'replay_completed',
  'same-request replay returns the completed operation'
);

select is(
  (
    select actor_turn_id
    from public.acttub_claim_coach_reply(
      '17000000-0000-0000-0002-000000000001',
      '17000000-0000-0000-0000-000000000001',
      '17000000-0000-0000-0004-000000000001',
      '17000000-0000-0000-0005-000000000002',
      repeat('b', 64),
      '17000000-0000-0000-0006-000000000099',
      '17000000-0000-0000-0007-000000000099',
      null,
      '17000000-0000-0000-0007-000000000001',
      '17000000-0000-0000-0008-000000000099',
      120
    )
  ),
  '17000000-0000-0000-0007-000000000001'::uuid,
  'same-request replay returns the original actor row'
);

select is(
  (select count(*) from public.practice_upstream_operations where request_id = '17000000-0000-0000-0005-000000000002'),
  1::bigint,
  'same-request replay does not create another operation'
);

select is(
  (select count(*) from public.practice_turns where run_id = '17000000-0000-0000-0004-000000000001'),
  2::bigint,
  'same-request replay does not duplicate actor or AI turns'
);

insert into public.practice_upstream_operations (
  id, session_id, user_id, run_id, request_id, request_fingerprint, kind, status,
  lease_token, lease_expires_at
) values (
  '17000000-0000-0000-0006-000000000003',
  '17000000-0000-0000-0002-000000000001',
  '17000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0004-000000000001',
  '17000000-0000-0000-0005-000000000003',
  repeat('c', 64),
  'coach_reply',
  'in_flight',
  '17000000-0000-0000-0008-000000000003',
  clock_timestamp() + interval '120 seconds'
);

select throws_ok(
  $$select public.acttub_complete_coach_turn(
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    '17000000-0000-0000-0006-000000000003',
    '17000000-0000-0000-0008-000000000003',
    'acting-session-1',
    '17000000-0000-0000-0009-000000000003',
    '일치하지 않는 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'P0001',
  'coach_actor_turn_cardinality_mismatch',
  'reply completion fails when zero pending actors match'
);

select is(
  (select status from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000003'),
  'in_flight',
  'zero-match failure rolls back operation completion'
);

select is(
  (select count(*) from public.practice_turns where id = '17000000-0000-0000-0009-000000000003'),
  0::bigint,
  'zero-match failure rolls back AI turn insertion'
);

delete from public.practice_upstream_operations
where id = '17000000-0000-0000-0006-000000000003';

alter table public.practice_turns
  drop constraint practice_turns_user_id_request_id_key;

insert into public.practice_turns (
  id, session_id, user_id, run_id, ordinal, role, delivery_status, request_id, text
) values
  (
    '17000000-0000-0000-0007-000000000004',
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    30,
    'actor',
    'pending',
    '17000000-0000-0000-0005-000000000004',
    '중복 배우 답변 하나'
  ),
  (
    '17000000-0000-0000-0007-000000000005',
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    31,
    'actor',
    'pending',
    '17000000-0000-0000-0005-000000000004',
    '중복 배우 답변 둘'
  );

insert into public.practice_upstream_operations (
  id, session_id, user_id, run_id, request_id, request_fingerprint, kind, status,
  lease_token, lease_expires_at
) values (
  '17000000-0000-0000-0006-000000000004',
  '17000000-0000-0000-0002-000000000001',
  '17000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0004-000000000001',
  '17000000-0000-0000-0005-000000000004',
  repeat('d', 64),
  'coach_retry_reply',
  'in_flight',
  '17000000-0000-0000-0008-000000000004',
  clock_timestamp() + interval '120 seconds'
);

select throws_ok(
  $$select public.acttub_complete_coach_turn(
    '17000000-0000-0000-0002-000000000001',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000001',
    '17000000-0000-0000-0006-000000000004',
    '17000000-0000-0000-0008-000000000004',
    'acting-session-1',
    '17000000-0000-0000-0009-000000000004',
    '중복 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'P0001',
  'coach_actor_turn_cardinality_mismatch',
  'retry completion fails when more than one pending actor matches'
);

select is(
  (
    select count(*)
    from public.practice_turns
    where request_id = '17000000-0000-0000-0005-000000000004'
      and delivery_status = 'pending'
  ),
  2::bigint,
  'multi-match failure rolls back both actor updates'
);

select is(
  (select status from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000004'),
  'in_flight',
  'multi-match failure rolls back operation completion'
);

select is(
  (select count(*) from public.practice_turns where id = '17000000-0000-0000-0009-000000000004'),
  0::bigint,
  'multi-match failure rolls back AI turn insertion'
);

insert into public.practice_upstream_operations (
  id, session_id, user_id, run_id, request_id, request_fingerprint, kind, status,
  lease_token, lease_expires_at
) values
  (
    '17000000-0000-0000-0006-000000000005',
    '17000000-0000-0000-0002-000000000002',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000002',
    '17000000-0000-0000-0005-000000000005',
    repeat('e', 64),
    'coach_start',
    'in_flight',
    '17000000-0000-0000-0008-000000000005',
    clock_timestamp() + interval '120 seconds'
  ),
  (
    '17000000-0000-0000-0006-000000000006',
    '17000000-0000-0000-0002-000000000003',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000003',
    '17000000-0000-0000-0005-000000000006',
    repeat('f', 64),
    'coach_restart',
    'in_flight',
    '17000000-0000-0000-0008-000000000006',
    clock_timestamp() + interval '120 seconds'
  );

select lives_ok(
  $$select public.acttub_complete_coach_turn(
    '17000000-0000-0000-0002-000000000002',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000002',
    '17000000-0000-0000-0006-000000000005',
    '17000000-0000-0000-0008-000000000005',
    'acting-session-2',
    '17000000-0000-0000-0009-000000000005',
    '시작 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'coach_start completes without an actor turn'
);

select lives_ok(
  $$select public.acttub_complete_coach_turn(
    '17000000-0000-0000-0002-000000000003',
    '17000000-0000-0000-0000-000000000001',
    '17000000-0000-0000-0004-000000000003',
    '17000000-0000-0000-0006-000000000006',
    '17000000-0000-0000-0008-000000000006',
    'acting-session-3',
    '17000000-0000-0000-0009-000000000006',
    '재시작 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'coach_restart completes without an actor turn'
);

select is(
  (select status from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000005'),
  'completed',
  'coach_start operation is completed'
);

select is(
  (select status from public.practice_upstream_operations where id = '17000000-0000-0000-0006-000000000006'),
  'completed',
  'coach_restart operation is completed'
);

select * from finish();

rollback;
