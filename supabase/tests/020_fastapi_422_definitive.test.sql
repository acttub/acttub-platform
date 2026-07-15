begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000001','authenticated','authenticated','fastapi-422-test@example.com',now(),now());

insert into public.profiles (id, email, status)
values ('20000000-0000-0000-0000-000000000001','fastapi-422-test@example.com','pending_terms');

insert into public.upload_intents (
  id,user_id,session_id,status,expected_storage_path,expected_mime_type,
  expected_size_bytes,duration_ms,finalized_at
)
select
  ('20000000-0000-0000-0001-'||lpad(value::text,12,'0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))::uuid,
  'finalized',
  'users/20000000-0000-0000-0000-000000000001/practice-sessions/'||
    ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))||'/take.mp4',
  'video/mp4',1024,1000,now()
from generate_series(1,4) as value;

insert into public.practice_sessions (
  id,user_id,upload_intent_id,status,pipeline_version,medium,genre,
  situation,character_context,subtext
)
select
  ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  ('20000000-0000-0000-0001-'||lpad(value::text,12,'0'))::uuid,
  case value when 1 then 'analyzing' when 4 then 'report' else 'interview' end,
  'acting-api-v1','기타','기타','상황','인물','의도'
from generate_series(1,4) as value;

insert into public.practice_takes (
  id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,analysis_status
)
select
  ('20000000-0000-0000-0003-'||lpad(value::text,12,'0'))::uuid,
  ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  'users/20000000-0000-0000-0000-000000000001/practice-sessions/'||
    ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))||'/take.mp4',
  'video/mp4',1024,1000,case when value=1 then 'pending' else 'completed' end
from generate_series(1,4) as value;

insert into public.scene_summaries (id,session_id,user_id,payload)
select
  ('20000000-0000-0000-0009-'||lpad(value::text,12,'0'))::uuid,
  ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  '{"scene":"summary"}'::jsonb
from generate_series(2,4) as value;

insert into public.practice_interview_runs (
  id,session_id,user_id,acting_session_id,status,start_mode,close_reason
) values
('20000000-0000-0000-0004-000000000002','20000000-0000-0000-0002-000000000002','20000000-0000-0000-0000-000000000001',null,'starting','initial',null),
('20000000-0000-0000-0004-000000000003','20000000-0000-0000-0002-000000000003','20000000-0000-0000-0000-000000000001','acting-session-reply','live','initial',null),
('20000000-0000-0000-0004-000000000004','20000000-0000-0000-0002-000000000004','20000000-0000-0000-0000-000000000001','acting-session-report','completed','initial','done');

update public.practice_sessions
set interview_run_id=('20000000-0000-0000-0004-'||right(id::text,12))::uuid
where right(id::text,12) in ('000000000002','000000000003','000000000004');

insert into public.practice_turns (
  id,session_id,user_id,run_id,ordinal,role,delivery_status,request_id,text
) values (
  '20000000-0000-0000-0007-000000000003',
  '20000000-0000-0000-0002-000000000003',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0004-000000000003',
  1,'actor','pending','20000000-0000-0000-0005-000000000003','배우 답변'
);

insert into public.practice_upstream_operations (
  id,session_id,user_id,run_id,request_id,request_fingerprint,kind,status,
  lease_token,lease_expires_at
)
select
  ('20000000-0000-0000-0006-'||lpad(value::text,12,'0'))::uuid,
  ('20000000-0000-0000-0002-'||lpad(value::text,12,'0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  case when value=1 or value=4 then null else ('20000000-0000-0000-0004-'||lpad(value::text,12,'0'))::uuid end,
  ('20000000-0000-0000-0005-'||lpad(value::text,12,'0'))::uuid,
  repeat(value::text,64),
  case value when 1 then 'analysis_retry' when 2 then 'coach_start' when 3 then 'coach_reply' else 'report' end,
  'in_flight',
  ('20000000-0000-0000-0008-'||lpad(value::text,12,'0'))::uuid,
  now()+interval '10 minutes'
from generate_series(1,4) as value;

select lives_ok($$select public.acttub_fail_analysis(
  '20000000-0000-0000-0002-000000000001','20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0006-000000000001','20000000-0000-0000-0008-000000000001',
  'definitive','acting_api_contract_mismatch')$$,'analysis 422 persists definitively');

select lives_ok($$select public.acttub_fail_coach_operation(
  '20000000-0000-0000-0002-000000000002','20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0004-000000000002','20000000-0000-0000-0006-000000000002',
  '20000000-0000-0000-0008-000000000002',null,'definitive','acting_api_contract_mismatch')$$,
  'coach start 422 persists definitively');

select lives_ok($$select public.acttub_fail_coach_operation(
  '20000000-0000-0000-0002-000000000003','20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0004-000000000003','20000000-0000-0000-0006-000000000003',
  '20000000-0000-0000-0008-000000000003','20000000-0000-0000-0007-000000000003',
  'definitive','acting_api_contract_mismatch')$$,'coach reply 422 persists definitively');

select lives_ok($$select public.acttub_fail_report(
  '20000000-0000-0000-0002-000000000004','20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0006-000000000004','20000000-0000-0000-0008-000000000004',
  'definitive','acting_api_contract_mismatch')$$,'report 422 persists definitively');

select is((select count(*) from public.practice_upstream_operations where safe_error_code='acting_api_contract_mismatch' and status='failed'),4::bigint,'all 422 operations are failed');
select is((select count(*) from public.practice_upstream_operations where status='outcome_unknown'),0::bigint,'no 422 operation is outcome unknown');
select is((select analysis_status from public.practice_takes where session_id='20000000-0000-0000-0002-000000000001'),'failed','analysis take is definitively failed');
select is((select analysis_retryable from public.practice_takes where session_id='20000000-0000-0000-0002-000000000001'),true,'analysis can recover with a new request');
select is((select status from public.practice_interview_runs where id='20000000-0000-0000-0004-000000000002'),'start_failed','coach start run is definitively failed');
select is((select failure_retryable from public.practice_interview_runs where id='20000000-0000-0000-0004-000000000002'),true,'coach start can recover with a new request');
select is((select status from public.practice_interview_runs where id='20000000-0000-0000-0004-000000000003'),'live','reply 422 preserves the live run');
select is((select delivery_status from public.practice_turns where id='20000000-0000-0000-0007-000000000003'),'failed','reply actor turn is definitively failed');
select is((select delivery_retryable from public.practice_turns where id='20000000-0000-0000-0007-000000000003'),true,'reply actor turn can be retried');
select is((select claim_state from public.acttub_claim_analysis_retry('20000000-0000-0000-0002-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0005-000000000001',repeat('1',64),'20000000-0000-0000-0096-000000000001','20000000-0000-0000-0098-000000000001',780)),'replay_failed','same analysis request stably replays failure');
select is((select claim_state from public.acttub_claim_coach_start('20000000-0000-0000-0002-000000000002','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0005-000000000002',repeat('2',64),'20000000-0000-0000-0096-000000000002','20000000-0000-0000-0094-000000000002','20000000-0000-0000-0098-000000000002',120,false)),'replay_failed','same coach start request stably replays failure');
select is((select claim_state from public.acttub_claim_coach_reply('20000000-0000-0000-0002-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0004-000000000003','20000000-0000-0000-0005-000000000003',repeat('3',64),'20000000-0000-0000-0096-000000000003','20000000-0000-0000-0097-000000000003',null,'20000000-0000-0000-0007-000000000003','20000000-0000-0000-0098-000000000003',120,null)),'replay_failed','same coach reply request stably replays failure');
select is((select claim_state from public.acttub_claim_report('20000000-0000-0000-0002-000000000004','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0005-000000000004',repeat('4',64),'20000000-0000-0000-0096-000000000004','20000000-0000-0000-0098-000000000004',120)),'replay_failed','same report request stably replays failure');
select is((select count(*) from public.practice_upstream_operations),4::bigint,'same-ID replays create no extra operation claims');
select is((select response_payload#>>'{error,message}' from public.practice_upstream_operations where id='20000000-0000-0000-0006-000000000001'),'The acting service could not accept this request.','replay uses a generic safe message');
select is((select claim_state from public.acttub_claim_analysis_retry('20000000-0000-0000-0002-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0015-000000000001',repeat('a',64),'20000000-0000-0000-0016-000000000001','20000000-0000-0000-0018-000000000001',780)),'claimed','new analysis request can be claimed');
select is((select claim_state from public.acttub_claim_coach_start('20000000-0000-0000-0002-000000000002','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0015-000000000002',repeat('b',64),'20000000-0000-0000-0016-000000000002','20000000-0000-0000-0014-000000000002','20000000-0000-0000-0018-000000000002',120,false)),'claimed','new coach start request can be claimed');
select is((select claim_state from public.acttub_claim_coach_reply('20000000-0000-0000-0002-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0004-000000000003','20000000-0000-0000-0015-000000000003',repeat('c',64),'20000000-0000-0000-0016-000000000003','20000000-0000-0000-0017-000000000003',null,'20000000-0000-0000-0007-000000000003','20000000-0000-0000-0018-000000000003',120,null)),'claimed','new retry_reply request can be claimed');
select is((select claim_state from public.acttub_claim_report('20000000-0000-0000-0002-000000000004','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0015-000000000004',repeat('d',64),'20000000-0000-0000-0016-000000000004','20000000-0000-0000-0018-000000000004',120)),'claimed','new report request can be claimed');
select is((select count(*) from public.practice_upstream_operations where status='in_flight'),4::bigint,'each recovery uses one new operation');

select * from finish();
rollback;
