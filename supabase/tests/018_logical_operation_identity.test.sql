begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '18000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'logical-operation-test@example.com',
  now(),
  now()
);

insert into public.profiles (id, email, status)
values (
  '18000000-0000-0000-0000-000000000001',
  'logical-operation-test@example.com',
  'pending_terms'
);

select is(
  (
    select id
    from public.acttub_create_upload_intent(
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0010-000000000001',
      repeat('f', 64),
      '18000000-0000-0000-0011-000000000001',
      '18000000-0000-0000-0012-000000000001',
      'practice-videos',
      'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0012-000000000001/take.mp4',
      'video/mp4',
      2048,
      now() + interval '2 hours'
    )
  ),
  '18000000-0000-0000-0011-000000000001'::uuid,
  'upload intent request identity creates the caller candidate once'
);

select is(
  (
    select id
    from public.acttub_create_upload_intent(
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0010-000000000001',
      repeat('f', 64),
      '18000000-0000-0000-0011-000000000099',
      '18000000-0000-0000-0012-000000000099',
      'practice-videos',
      'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0012-000000000099/take.mp4',
      'video/mp4',
      2048,
      now() + interval '2 hours'
    )
  ),
  '18000000-0000-0000-0011-000000000001'::uuid,
  'same upload request and payload replay the original resource identity'
);

select is(
  (
    select session_id
    from public.acttub_create_upload_intent(
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0010-000000000001',
      repeat('f', 64),
      '18000000-0000-0000-0011-000000000098',
      '18000000-0000-0000-0012-000000000098',
      'practice-videos',
      'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0012-000000000098/take.mp4',
      'video/mp4',
      2048,
      now() + interval '2 hours'
    )
  ),
  '18000000-0000-0000-0012-000000000001'::uuid,
  'same upload request retains the original session and storage identity'
);

select throws_ok(
  $$select * from public.acttub_create_upload_intent(
    '18000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0010-000000000001',
    repeat('0', 64),
    '18000000-0000-0000-0011-000000000097',
    '18000000-0000-0000-0012-000000000097',
    'practice-videos',
    'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0012-000000000097/take.mp4',
    'video/mp4',
    4096,
    now() + interval '2 hours'
  )$$,
  'P0001',
  'request_id_conflict',
  'same upload request with a different payload remains a conflict'
);

select is(
  (
    select count(*)
    from public.upload_intents
    where user_id = '18000000-0000-0000-0000-000000000001'
      and request_id = '18000000-0000-0000-0010-000000000001'
  ),
  1::bigint,
  'upload request replay and conflict leave one stored intent'
);

insert into public.upload_intents (
  id, user_id, session_id, status, expected_storage_path, expected_mime_type,
  expected_size_bytes, duration_ms, finalized_at
) values (
  '18000000-0000-0000-0001-000000000001',
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0002-000000000001',
  'finalized',
  'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0002-000000000001/take.mp4',
  'video/mp4',
  1024,
  1000,
  now()
);

insert into public.practice_sessions (
  id, user_id, upload_intent_id, status, pipeline_version, medium, genre,
  situation, character_context, subtext
) values (
  '18000000-0000-0000-0002-000000000001',
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0001-000000000001',
  'interview',
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
  '18000000-0000-0000-0003-000000000001',
  '18000000-0000-0000-0002-000000000001',
  '18000000-0000-0000-0000-000000000001',
  'users/18000000-0000-0000-0000-000000000001/practice-sessions/18000000-0000-0000-0002-000000000001/take.mp4',
  'video/mp4',
  1024,
  1000,
  'completed'
);

insert into public.practice_interview_runs (
  id, session_id, user_id, acting_session_id, status, start_mode
) values (
  '18000000-0000-0000-0004-000000000001',
  '18000000-0000-0000-0002-000000000001',
  '18000000-0000-0000-0000-000000000001',
  'acting-session-identity',
  'live',
  'initial'
);

update public.practice_sessions
set interview_run_id = '18000000-0000-0000-0004-000000000001'
where id = '18000000-0000-0000-0002-000000000001';

insert into public.practice_turns (
  id, session_id, user_id, run_id, ordinal, role, delivery_status, text
) values (
  '18000000-0000-0000-0009-000000000000',
  '18000000-0000-0000-0002-000000000001',
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0004-000000000001',
  1,
  'ai',
  'completed',
  '첫 번째 질문'
);

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001',
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0004-000000000001',
      '18000000-0000-0000-0005-000000000001',
      repeat('a', 64),
      '18000000-0000-0000-0006-000000000001',
      '18000000-0000-0000-0007-000000000001',
      '첫 답변',
      null,
      '18000000-0000-0000-0008-000000000001',
      120,
      '18000000-0000-0000-0009-000000000000'
    )
  ),
  'claimed',
  'normal reply claims request A'
);

select lives_ok(
  $$select public.acttub_complete_coach_turn(
    '18000000-0000-0000-0002-000000000001',
    '18000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0004-000000000001',
    '18000000-0000-0000-0006-000000000001',
    '18000000-0000-0000-0008-000000000001',
    'acting-session-identity',
    '18000000-0000-0000-0009-000000000001',
    '두 번째 질문',
    'continue',
    null,
    false,
    null,
    '{}'::jsonb
  )$$,
  'request A completes one actor and one AI effect'
);

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001',
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0004-000000000001',
      '18000000-0000-0000-0005-000000000001',
      repeat('a', 64),
      '18000000-0000-0000-0006-000000000099',
      '18000000-0000-0000-0007-000000000099',
      '첫 답변',
      null,
      '18000000-0000-0000-0008-000000000099',
      120,
      '18000000-0000-0000-0009-000000000000'
    )
  ),
  'replay_completed',
  'same request A replays its completed result'
);

select is(
  (
    select operation_id
    from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001',
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0004-000000000001',
      '18000000-0000-0000-0005-000000000001',
      repeat('a', 64),
      '18000000-0000-0000-0006-000000000099',
      '18000000-0000-0000-0007-000000000099',
      '첫 답변',
      null,
      '18000000-0000-0000-0008-000000000099',
      120,
      '18000000-0000-0000-0009-000000000000'
    )
  ),
  '18000000-0000-0000-0006-000000000001'::uuid,
  'same request A returns the original operation identity'
);

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001',
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0004-000000000001',
      '18000000-0000-0000-0005-000000000001',
      repeat('a', 64),
      '18000000-0000-0000-0006-000000000097',
      '18000000-0000-0000-0007-000000000097',
      '첫 답변',
      null,
      '18000000-0000-0000-0008-000000000097',
      120
    )
  ),
  'replay_completed',
  'legacy reply callers may omit expectedAiTurnId and still replay completed work'
);

select is(
  (select count(*) from public.practice_turns where role = 'actor'),
  1::bigint,
  'completed replay leaves one actor effect'
);

select is(
  (select count(*) from public.practice_turns where role = 'ai'),
  2::bigint,
  'completed replay leaves the initial question and one AI effect'
);

select is(
  (select count(*) from public.practice_upstream_operations where request_id = '18000000-0000-0000-0005-000000000001'),
  1::bigint,
  'completed replay leaves one upstream operation'
);

select throws_ok(
  $$select * from public.acttub_claim_coach_reply(
    '18000000-0000-0000-0002-000000000001',
    '18000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0004-000000000001',
    '18000000-0000-0000-0005-000000000001',
    repeat('b', 64),
    '18000000-0000-0000-0006-000000000098',
    '18000000-0000-0000-0007-000000000098',
    '바뀐 답변',
      null,
      '18000000-0000-0000-0008-000000000098',
      120,
      '18000000-0000-0000-0009-000000000000'
  )$$,
  'P0001',
  'request_id_conflict',
  'same request ID with a different payload remains a conflict'
);

select is(
  (select count(*) from public.practice_turns),
  3::bigint,
  'request ID conflict creates no turn side effect'
);

create temporary table stale_claim_result (error_code text not null);

do $stale_claim$
begin
  begin
    perform * from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001'::uuid,
      '18000000-0000-0000-0000-000000000001'::uuid,
      '18000000-0000-0000-0004-000000000001'::uuid,
      '18000000-0000-0000-0005-000000000002'::uuid,
      repeat('c', 64),
      '18000000-0000-0000-0006-000000000002'::uuid,
      '18000000-0000-0000-0007-000000000002'::uuid,
      '오래된 질문에 대한 답변'::text,
      null::uuid,
      '18000000-0000-0000-0008-000000000002'::uuid,
      120,
      '18000000-0000-0000-0009-000000000000'::uuid
    );
    insert into stale_claim_result values ('accepted');
  exception
    when undefined_function then
      insert into stale_claim_result values ('stale_turn_contract_missing');
    when others then
      insert into stale_claim_result values (sqlerrm);
  end;
end
$stale_claim$;

select is(
  (select error_code from stale_claim_result),
  'stale_ai_turn',
  'a new request ID with a stale expected AI turn is rejected'
);

select is(
  (select count(*) from public.practice_turns where role = 'actor'),
  1::bigint,
  'stale expected AI turn is rejected before inserting an actor effect'
);

select is(
  (select count(*) from public.practice_upstream_operations),
  1::bigint,
  'stale expected AI turn is rejected before creating an upstream operation'
);

select is(
  (
    select claim_state
    from public.acttub_claim_coach_reply(
      '18000000-0000-0000-0002-000000000001',
      '18000000-0000-0000-0000-000000000001',
      '18000000-0000-0000-0004-000000000001',
      '18000000-0000-0000-0005-000000000003',
      repeat('d', 64),
      '18000000-0000-0000-0006-000000000003',
      '18000000-0000-0000-0007-000000000003',
      '현재 질문에 대한 답변',
      null,
      '18000000-0000-0000-0008-000000000003',
      120,
      '18000000-0000-0000-0009-000000000001'
    )
  ),
  'claimed',
  'the current AI turn can be claimed once'
);

select throws_ok(
  $$select * from public.acttub_claim_coach_reply(
    '18000000-0000-0000-0002-000000000001',
    '18000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0004-000000000001',
    '18000000-0000-0000-0005-000000000004',
    repeat('e', 64),
    '18000000-0000-0000-0006-000000000004',
    '18000000-0000-0000-0007-000000000004',
    '동시에 보낸 두 번째 답변',
    null,
    '18000000-0000-0000-0008-000000000004',
    120,
    '18000000-0000-0000-0009-000000000001'
  )$$,
  'P0001',
  'operation_in_progress',
  'the existing pending-operation guard rejects a concurrent actor reply before duplicate side effects'
);

select is(
  (select count(*) from public.practice_turns where role = 'actor'),
  2::bigint,
  'concurrent pending protection leaves only the first new actor effect'
);

select * from finish();
rollback;
