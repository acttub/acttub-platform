begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('21000000-0000-0000-0000-000000000001','authenticated','authenticated','relay-metadata-test@example.com',now(),now());

insert into public.profiles (id, email, status)
values ('21000000-0000-0000-0000-000000000001','relay-metadata-test@example.com','pending_terms');

insert into public.upload_intents (
  id,user_id,session_id,status,expected_storage_path,expected_mime_type,
  expected_size_bytes,duration_ms,finalized_at,expires_at
) values
(
  '21000000-0000-0000-0001-000000000001','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0002-000000000001','finalized',
  'users/21000000-0000-0000-0000-000000000001/practice-sessions/21000000-0000-0000-0002-000000000001/take.mp4',
  'video/mp4',1024,1000,now(),now()+interval '10 minutes'
),
(
  '21000000-0000-0000-0001-000000000002','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0002-000000000002','finalized',
  'users/21000000-0000-0000-0000-000000000001/practice-sessions/21000000-0000-0000-0002-000000000002/take.mov',
  'video/quicktime',1024,1000,now(),now()+interval '10 minutes'
);

create temporary table invalid_claim as select * from public.acttub_create_acting_session(
  '21000000-0000-0000-0001-000000000001','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0002-000000000001','21000000-0000-0000-0003-000000000001',
  '21000000-0000-0000-0005-000000000001',repeat('a',64),
  '21000000-0000-0000-0006-000000000001','21000000-0000-0000-0008-000000000001',
  '기타','기타','상황','인물','의도',780,now()
);

select is((select claim_state from invalid_claim),'claimed','the source reaches the application validation boundary');

select is((select analysis_source->>'mimeType' from invalid_claim),'video/mp4','the claim preserves persisted MIME without a browser filename');

select lives_ok($$select public.acttub_fail_analysis(
  '21000000-0000-0000-0002-000000000001','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0006-000000000001','21000000-0000-0000-0008-000000000001',
  'definitive','source_video_metadata_invalid')$$,'metadata rejection persists definitively before dispatch');

select is((select status from public.practice_upstream_operations where id='21000000-0000-0000-0006-000000000001'),'failed','metadata rejection marks the operation failed');
select is((select analysis_status from public.practice_takes where id='21000000-0000-0000-0003-000000000001'),'failed','metadata rejection marks the take failed');
select is((select analysis_retryable from public.practice_takes where id='21000000-0000-0000-0003-000000000001'),false,'metadata rejection is non-retryable');
select is((select analysis_error from public.practice_takes where id='21000000-0000-0000-0003-000000000001'),'source_video_metadata_invalid','the take stores the stable metadata code');

select is((select claim_state from public.acttub_create_acting_session(
  '21000000-0000-0000-0001-000000000001','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0002-000000000001','21000000-0000-0000-0093-000000000001',
  '21000000-0000-0000-0005-000000000001',repeat('a',64),
  '21000000-0000-0000-0096-000000000001','21000000-0000-0000-0098-000000000001',
  '기타','기타','상황','인물','의도',780,now()
)),'replay_failed','same request ID replays the definitive metadata failure');

select is((select response_payload#>>'{error,code}' from public.acttub_operation_claim_state(
  '21000000-0000-0000-0000-000000000001','21000000-0000-0000-0005-000000000001',repeat('a',64)
)),'source_video_metadata_invalid','same-ID replay preserves the stable metadata code');
select is((select count(*) from public.practice_upstream_operations),1::bigint,'same-ID replay creates no new claim or dispatch record');

create temporary table valid_claim as select * from public.acttub_create_acting_session(
  '21000000-0000-0000-0001-000000000002','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0002-000000000002','21000000-0000-0000-0003-000000000002',
  '21000000-0000-0000-0005-000000000002',repeat('b',64),
  '21000000-0000-0000-0006-000000000002','21000000-0000-0000-0008-000000000002',
  '기타','기타','상황','인물','의도',780,now()
);

select is((select claim_state from valid_claim),'claimed','a new valid QuickTime request can proceed');

select is((select analysis_source->>'storagePath' from valid_claim),'users/21000000-0000-0000-0000-000000000001/practice-sessions/21000000-0000-0000-0002-000000000002/take.mov','the valid request keeps its canonical MOV path');

select lives_ok($$select public.acttub_complete_analysis(
  '21000000-0000-0000-0002-000000000002','21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0006-000000000002','21000000-0000-0000-0008-000000000002',
  '21000000-0000-0000-0009-000000000002','{"scene":"summary"}'::jsonb
)$$,'the valid QuickTime request can complete');

select is((select analysis_status from public.practice_takes where id='21000000-0000-0000-0003-000000000002'),'completed','the valid request completes its take');
select is((select count(*) from public.practice_upstream_operations),2::bigint,'only the invalid and new valid logical requests exist');

select * from finish();
rollback;
