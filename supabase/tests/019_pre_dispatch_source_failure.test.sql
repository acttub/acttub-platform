begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '19000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'source-failure-test@example.com',
  now(),
  now()
);

insert into public.profiles (id, email, status)
values (
  '19000000-0000-0000-0000-000000000001',
  'source-failure-test@example.com',
  'pending_terms'
);

insert into public.upload_intents (
  id, user_id, session_id, status, expected_storage_path, expected_mime_type,
  expected_size_bytes, duration_ms, finalized_at
) values (
  '19000000-0000-0000-0001-000000000001',
  '19000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0002-000000000001',
  'finalized',
  'users/19000000-0000-0000-0000-000000000001/practice-sessions/19000000-0000-0000-0002-000000000001/take.mp4',
  'video/mp4',
  1024,
  1000,
  now()
);

insert into public.practice_sessions (
  id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
  situation, character_context, subtext
) values (
  '19000000-0000-0000-0002-000000000001',
  '19000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0001-000000000001',
  'analyzing',
  'acting-api-v1',
  '기타',
  '기타',
  '상황',
  '인물',
  '의도'
);

insert into public.practice_takes (
  id, session_id, user_id, storage_path, mime_type, size_bytes, duration_ms,
  analysis_status
) values (
  '19000000-0000-0000-0003-000000000001',
  '19000000-0000-0000-0002-000000000001',
  '19000000-0000-0000-0000-000000000001',
  'users/19000000-0000-0000-0000-000000000001/practice-sessions/19000000-0000-0000-0002-000000000001/take.mp4',
  'video/mp4',
  1024,
  1000,
  'pending'
);

insert into public.practice_upstream_operations (
  id, session_id, user_id, request_id, request_fingerprint, kind, status,
  lease_token, lease_expires_at
) values (
  '19000000-0000-0000-0006-000000000001',
  '19000000-0000-0000-0002-000000000001',
  '19000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0005-000000000001',
  repeat('a', 64),
  'analysis_create',
  'in_flight',
  '19000000-0000-0000-0008-000000000001',
  now() + interval '10 minutes'
);

select lives_ok(
  $$select public.acttub_fail_analysis(
    '19000000-0000-0000-0002-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0006-000000000001',
    '19000000-0000-0000-0008-000000000001',
    'definitive',
    'source_video_unavailable'
  )$$,
  'source preparation failure is persisted definitively'
);

select is(
  (select status from public.practice_upstream_operations where id = '19000000-0000-0000-0006-000000000001'),
  'failed',
  'source failure marks the operation failed'
);

select is(
  (select analysis_status from public.practice_takes where id = '19000000-0000-0000-0003-000000000001'),
  'failed',
  'source failure marks the take failed'
);

select is(
  (select analysis_error from public.practice_takes where id = '19000000-0000-0000-0003-000000000001'),
  'source_video_unavailable',
  'source failure stores the stable error code'
);

select is(
  (select analysis_retryable from public.practice_takes where id = '19000000-0000-0000-0003-000000000001'),
  true,
  'source failure allows retrying the same stored video'
);

select is(
  (
    select claim_state
    from public.acttub_operation_claim_state(
      '19000000-0000-0000-0000-000000000001',
      '19000000-0000-0000-0005-000000000001',
      repeat('a', 64)
    )
  ),
  'replay_failed',
  'same request ID replays the definitive failure'
);

select is(
  (
    select response_payload->>'status'
    from public.acttub_operation_claim_state(
      '19000000-0000-0000-0000-000000000001',
      '19000000-0000-0000-0005-000000000001',
      repeat('a', 64)
    )
  ),
  '503',
  'same-ID replay preserves the source error HTTP status'
);

select is(
  (
    select response_payload #>> '{error,details,retryAllowed}'
    from public.acttub_operation_claim_state(
      '19000000-0000-0000-0000-000000000001',
      '19000000-0000-0000-0005-000000000001',
      repeat('a', 64)
    )
  ),
  'true',
  'same-ID replay preserves retryable source error details'
);

select is(
  (select status from public.practice_sessions where id = '19000000-0000-0000-0002-000000000001'),
  'analyzing',
  'definitive source failure keeps the same session ready for analysis retry'
);

select is(
  (
    select claim_state
    from public.acttub_claim_analysis_retry(
      '19000000-0000-0000-0002-000000000001',
      '19000000-0000-0000-0000-000000000001',
      '19000000-0000-0000-0005-000000000002',
      repeat('b', 64),
      '19000000-0000-0000-0006-000000000002',
      '19000000-0000-0000-0008-000000000002',
      780
    )
  ),
  'claimed',
  'a new request and operation ID claim a retry'
);

select is(
  (select storage_path from public.practice_takes where id = '19000000-0000-0000-0003-000000000001'),
  'users/19000000-0000-0000-0000-000000000001/practice-sessions/19000000-0000-0000-0002-000000000001/take.mp4',
  'retry keeps the original private Storage object'
);

select is(
  (select status from public.practice_upstream_operations where id = '19000000-0000-0000-0006-000000000002'),
  'in_flight',
  'retry uses the new operation ID'
);

select lives_ok(
  $$select public.acttub_complete_analysis(
    '19000000-0000-0000-0002-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0006-000000000002',
    '19000000-0000-0000-0008-000000000002',
    '19000000-0000-0000-0009-000000000001',
    '{"scene":"summary"}'::jsonb
  )$$,
  'the new retry operation can complete successfully'
);

select is(
  (select analysis_status from public.practice_takes where id = '19000000-0000-0000-0003-000000000001'),
  'completed',
  'successful retry completes the existing take'
);

select is(
  (select status from public.practice_sessions where id = '19000000-0000-0000-0002-000000000001'),
  'interview',
  'successful retry advances the existing session to interview'
);

select * from finish();
rollback;
