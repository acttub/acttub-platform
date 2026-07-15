begin;
select plan(50);
select has_table('public','upload_quota_policy','private quota policy exists');
select has_table('public','upload_cleanup_jobs','durable cleanup jobs exist');
select has_column('public','upload_intents','actual_size_bytes','actual bytes are persisted');
select has_column('public','upload_intents','consumed_at','consumption is fenced');
select has_column('public','upload_intents','cleanup_completed_at','physical cleanup releases quota');
select has_function('public','acttub_claim_upload_cleanup_jobs',array['uuid','integer','integer','text'],'lease claim RPC exists');
select has_function('public','acttub_record_upload_cleanup_observation',array['uuid','uuid','bigint'],'live observation RPC exists');
select has_function('public','acttub_complete_upload_cleanup',array['uuid','uuid','boolean','bigint'],'completion CAS exists');
select has_function('public','acttub_record_trusted_media_probe_v2',array['uuid','uuid','uuid','uuid','integer','text','bigint'],'actual-byte probe exists');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('23000000-0000-0000-0000-000000000001','authenticated','authenticated','quota@example.com',now(),now()),
 ('23000000-0000-0000-0000-000000000002','authenticated','authenticated','bytes@example.com',now(),now()),
 ('23000000-0000-0000-0000-000000000003','authenticated','authenticated','cleanup@example.com',now(),now()),
 ('23000000-0000-0000-0000-000000000004','authenticated','authenticated','audit@example.com',now(),now());
insert into public.profiles(id,email,status) values
 ('23000000-0000-0000-0000-000000000001','quota@example.com','pending_terms'),
 ('23000000-0000-0000-0000-000000000002','bytes@example.com','pending_terms'),
 ('23000000-0000-0000-0000-000000000003','cleanup@example.com','pending_terms'),
 ('23000000-0000-0000-0000-000000000004','audit@example.com','pending_terms');

select lives_ok($$select * from public.acttub_create_upload_intent('23000000-0000-0000-0000-000000000001','23000000-0000-0000-0010-000000000001',repeat('a',64),'23000000-0000-0000-0020-000000000001','23000000-0000-0000-0030-000000000001','practice-videos','users/23000000-0000-0000-0000-000000000001/practice-sessions/23000000-0000-0000-0030-000000000001/take.mp4','video/mp4',10,now()+interval '2 hour')$$,'first logical request admitted');
insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes)
select gen_random_uuid(),'23000000-0000-0000-0000-000000000001',s.id,'created','users/23000000-0000-0000-0000-000000000001/practice-sessions/'||s.id||'/take.mp4','video/mp4',10
from generate_series(1,4) gs cross join lateral (select gen_random_uuid() id where gs=gs) s;
select lives_ok($$select * from public.acttub_create_upload_intent('23000000-0000-0000-0000-000000000001','23000000-0000-0000-0010-000000000001',repeat('a',64),gen_random_uuid(),gen_random_uuid(),'practice-videos','ignored','video/mp4',10,now()+interval '2 hour')$$,'same request replay survives count limit');
select throws_ok($$select * from public.acttub_create_upload_intent('23000000-0000-0000-0000-000000000001','23000000-0000-0000-0010-000000000001',repeat('b',64),gen_random_uuid(),gen_random_uuid(),'practice-videos','ignored','video/mp4',10,now()+interval '2 hour')$$,'P0001','request_id_conflict','changed replay fingerprint conflicts');
select throws_ok($$insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes) values(gen_random_uuid(),'23000000-0000-0000-0000-000000000001','23000000-0000-0000-0090-000000000001','created','users/23000000-0000-0000-0000-000000000001/practice-sessions/23000000-0000-0000-0090-000000000001/take.mp4','video/mp4',1)$$,'P0001','upload_quota_exceeded','N+1 active intent is rejected');

update public.upload_quota_policy set max_active_intents=20,max_active_bytes=100;
insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes)
 values(gen_random_uuid(),'23000000-0000-0000-0000-000000000002','23000000-0000-0000-0091-000000000001','created','users/23000000-0000-0000-0000-000000000002/practice-sessions/23000000-0000-0000-0091-000000000001/take.mp4','video/mp4',60);
select lives_ok($$insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes) values(gen_random_uuid(),'23000000-0000-0000-0000-000000000002','23000000-0000-0000-0092-000000000001','created','users/23000000-0000-0000-0000-000000000002/practice-sessions/23000000-0000-0000-0092-000000000001/take.mp4','video/mp4',40)$$,'byte equality is admitted');
select throws_ok($$insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes) values(gen_random_uuid(),'23000000-0000-0000-0000-000000000002','23000000-0000-0000-0093-000000000001','created','users/23000000-0000-0000-0000-000000000002/practice-sessions/23000000-0000-0000-0093-000000000001/take.mp4','video/mp4',1)$$,'P0001','upload_quota_exceeded','one byte over is rejected');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at)
 values('23000000-0000-0000-0040-000000000001','23000000-0000-0000-0000-000000000003','23000000-0000-0000-0050-000000000001','created','users/23000000-0000-0000-0000-000000000003/practice-sessions/23000000-0000-0000-0050-000000000001/take.mp4','video/mp4',25,now()-interval '1 hour');
select is((select count(*) from public.acttub_claim_upload_cleanup_jobs('23000000-0000-0000-0060-000000000001',120,1,'pgtap')),1::bigint,'expired unreferenced intent is claimed');
select is((select status from public.upload_intents where id='23000000-0000-0000-0040-000000000001'),'cleanup_failed','claim fences finalize/consume status');
select throws_ok($$select public.acttub_complete_upload_cleanup('23000000-0000-0000-0000-000000000000','23000000-0000-0000-0000-000000000000',false,null)$$,'P0001','stale_cleanup_lease','stale completion is fenced');
select lives_ok($$select public.acttub_complete_upload_cleanup((select id from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0040-000000000001'),'23000000-0000-0000-0060-000000000001',false,null)$$,'already-absent completion succeeds');
select ok((select cleanup_completed_at is not null from public.upload_intents where id='23000000-0000-0000-0040-000000000001'),'only completion releases quota');
select is((select count(*) from public.upload_intents where user_id='23000000-0000-0000-0000-000000000003' and consumed_at is null and cleanup_completed_at is null),0::bigint,'completed cleanup leaves active quota');
select ok(not has_table_privilege('authenticated','public.upload_cleanup_jobs','select'),'browser cannot read cleanup jobs');
select ok(not has_table_privilege('authenticated','public.upload_quota_policy','select'),'browser cannot read quota policy');
select is((select count(*) from public.practice_sessions s join public.upload_intents u on u.id=s.upload_intent_id where u.consumed_at is null),0::bigint,'existing references are backfilled consumed');

update public.upload_quota_policy set max_active_intents=20,max_active_bytes=1000;
insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values
 ('23000000-0000-0000-0070-000000000001','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0071-000000000001','created','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0071-000000000001/take.mp4','video/mp4',10,clock_timestamp()-interval '29 minutes'),
 ('23000000-0000-0000-0070-000000000002','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0071-000000000002','created','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0071-000000000002/take.mp4','video/mp4',10,clock_timestamp()-interval '31 minutes');
select is((select count(*) from public.acttub_claim_upload_cleanup_jobs('23000000-0000-0000-0072-000000000001',120,10,'grace')),1::bigint,'created intent is eligible only after TTL plus configured grace');
select ok(not exists(select 1 from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0070-000000000001'),'just-before grace boundary is excluded');
select is((select status from public.upload_intents where id='23000000-0000-0000-0070-000000000002'),'cleanup_failed','at-after grace candidate is fenced by claim');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values
 ('23000000-0000-0000-0070-000000000003','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0071-000000000003','created','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0071-000000000003/take.mp4','video/mp4',10,clock_timestamp()+interval '1 hour');
select is(public.acttub_observe_upload_object('23000000-0000-0000-0070-000000000003','23000000-0000-0000-0000-000000000004',50,'video/mp4'),'source_video_metadata_invalid','first differing observation fences the upload');
select is(public.acttub_observe_upload_object('23000000-0000-0000-0070-000000000003','23000000-0000-0000-0000-000000000004',5,'video/mp4'),'source_video_metadata_invalid','second different observation fails closed');
select is((select actual_size_bytes from public.upload_intents where id='23000000-0000-0000-0070-000000000003'),50::bigint,'later smaller observation cannot lower authoritative quota');
select is((select count(*) from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0070-000000000003'),1::bigint,'repeated mismatch retains one durable cleanup job');

select throws_ok($$select public.acttub_fail_upload_cleanup((select id from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0070-000000000002'),'23000000-0000-0000-0072-000000000099','storage_delete_failed')$$,'P0001','stale_cleanup_lease','stale failure CAS is rejected');
select lives_ok($$select public.acttub_fail_upload_cleanup((select id from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0070-000000000002'),'23000000-0000-0000-0072-000000000001','storage_delete_failed')$$,'live failure requeues cleanup');
select ok((select status='failed' and available_at>clock_timestamp() from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0070-000000000002'),'failure applies durable backoff');
select ok(not has_function_privilege('authenticated','public.acttub_claim_upload_cleanup_jobs(uuid,integer,integer,text)','execute'),'browser cannot execute cleanup claims');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values
 ('23000000-0000-0000-0080-000000000001','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0081-000000000001','validation_failed','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0081-000000000001/take.mp4','video/mp4',10,clock_timestamp()-interval '1 hour'),
 ('23000000-0000-0000-0080-000000000002','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0081-000000000002','validation_failed','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0081-000000000002/take.mp4','video/mp4',10,clock_timestamp()-interval '1 hour'),
 ('23000000-0000-0000-0080-000000000003','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0081-000000000003','validation_failed','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0081-000000000003/take.mp4','video/mp4',10,clock_timestamp()-interval '1 hour');
insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext) values
 ('23000000-0000-0000-0081-000000000001','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0080-000000000001','analyzing','acting-api-v1','기타','기타','상황','인물','의도'),
 ('23000000-0000-0000-0081-000000000002','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0080-000000000002','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,analysis_status,analysis_retryable) values
 ('23000000-0000-0000-0082-000000000001','23000000-0000-0000-0081-000000000001','23000000-0000-0000-0000-000000000004','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0081-000000000001/take.mp4','video/mp4',10,'failed',true),
 ('23000000-0000-0000-0082-000000000002','23000000-0000-0000-0081-000000000002','23000000-0000-0000-0000-000000000004','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0081-000000000002/take.mp4','video/mp4',10,'failed',false);
insert into public.practice_upstream_operations(id,session_id,user_id,request_id,request_fingerprint,kind,status) values
 ('23000000-0000-0000-0083-000000000001','23000000-0000-0000-0081-000000000001','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0084-000000000001',repeat('a',64),'analysis_create','queued'),
 ('23000000-0000-0000-0083-000000000002','23000000-0000-0000-0081-000000000002','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0084-000000000002',repeat('b',64),'analysis_create','failed');
insert into public.upload_cleanup_jobs(upload_intent_id,reason,status,available_at) values
 ('23000000-0000-0000-0080-000000000001','validation_failed','queued',clock_timestamp()),
 ('23000000-0000-0000-0080-000000000002','validation_failed','queued',clock_timestamp()),
 ('23000000-0000-0000-0080-000000000003','validation_failed','queued',clock_timestamp());
select is((select count(*) from public.acttub_claim_upload_cleanup_job('23000000-0000-0000-0080-000000000001','23000000-0000-0000-0085-000000000001',30,'live-op')),0::bigint,'queued operation and retryable failure exclude cleanup');
select is((select count(*) from public.acttub_claim_upload_cleanup_job('23000000-0000-0000-0080-000000000002','23000000-0000-0000-0085-000000000002',30,'terminal')),1::bigint,'terminal nonretryable validation failure is claimable');
update public.upload_intents set consumed_at=clock_timestamp() where id='23000000-0000-0000-0080-000000000003';
select is((select count(*) from public.acttub_claim_upload_cleanup_job('23000000-0000-0000-0080-000000000003','23000000-0000-0000-0085-000000000003',30,'consumed')),0::bigint,'consumed intent is never claimable');
update public.upload_cleanup_jobs set status='in_flight',lease_token='23000000-0000-0000-0085-000000000004',lease_expires_at=clock_timestamp()-interval '1 second' where upload_intent_id='23000000-0000-0000-0080-000000000001';
update public.practice_upstream_operations set status='failed' where id='23000000-0000-0000-0083-000000000001';
update public.practice_takes set analysis_retryable=false where id='23000000-0000-0000-0082-000000000001';
select is((select count(*) from public.acttub_claim_upload_cleanup_job('23000000-0000-0000-0080-000000000001','23000000-0000-0000-0085-000000000005',30,'reclaim')),1::bigint,'expired lease is reclaimed only after analysis becomes terminal');
select is((select attempt_count from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0080-000000000001'),1,'reclaim records one owned cleanup attempt');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at) values
 ('23000000-0000-0000-0090-000000000001','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0091-000000000001','created','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000001/take.mp4','video/mp4',10,clock_timestamp()+interval '1 hour');
select is(public.acttub_observe_upload_object('23000000-0000-0000-0090-000000000001','23000000-0000-0000-0000-000000000004',10,null),'source_video_metadata_invalid','missing MIME with known size is a committed mismatch');
select is((select actual_size_bytes from public.upload_intents where id='23000000-0000-0000-0090-000000000001'),10::bigint,'missing MIME still persists authoritative bytes');
select is((select count(*) from public.upload_cleanup_jobs where upload_intent_id='23000000-0000-0000-0090-000000000001'),1::bigint,'missing MIME enqueues durable cleanup');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,reported_duration_ms,expires_at,consumed_at) values
 ('23000000-0000-0000-0090-000000000004','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0091-000000000004','finalized','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000004/take.mp4','video/mp4',10,1000,clock_timestamp()+interval '1 hour',clock_timestamp());
select lives_ok($$select * from public.acttub_finalize_upload_intent('23000000-0000-0000-0090-000000000004','23000000-0000-0000-0000-000000000004','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000004/take.mp4',1000)$$,'compatible finalize replay survives successful consumption');
select throws_ok($$select * from public.acttub_finalize_upload_intent('23000000-0000-0000-0090-000000000004','23000000-0000-0000-0000-000000000004','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000004/take.mp4',1001)$$,'P0001','upload_intent_invalid','consumed finalize rejects a new mutation');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,expires_at,cleanup_completed_at) values
 ('23000000-0000-0000-0090-000000000002','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0091-000000000002','expired','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000002/take.mp4','video/mp4',10,clock_timestamp()-interval '60 days',clock_timestamp()-interval '40 days'),
 ('23000000-0000-0000-0090-000000000003','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0091-000000000003','expired','users/23000000-0000-0000-0000-000000000004/practice-sessions/23000000-0000-0000-0091-000000000003/take.mp4','video/mp4',10,clock_timestamp()-interval '60 days',clock_timestamp()-interval '40 days');
insert into public.upload_cleanup_jobs(upload_intent_id,reason,status,completed_at,created_at,updated_at) values
 ('23000000-0000-0000-0090-000000000002','expired_unfinalized','completed',clock_timestamp()-interval '40 days',clock_timestamp()-interval '60 days',clock_timestamp()-interval '40 days'),
 ('23000000-0000-0000-0090-000000000003','expired_unfinalized','completed',clock_timestamp()-interval '40 days',clock_timestamp()-interval '60 days',clock_timestamp()-interval '40 days');
insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext) values
 ('23000000-0000-0000-0091-000000000003','23000000-0000-0000-0000-000000000004','23000000-0000-0000-0090-000000000003','analyzing','acting-api-v1','기타','기타','상황','인물','의도');
select is(public.acttub_purge_upload_cleanup_tombstones(10),1::bigint,'retention purge removes an aged completed unreferenced tombstone');
select ok(not exists(select 1 from public.upload_intents where id='23000000-0000-0000-0090-000000000002'),'purge removes the orphan intent and cascading job');
select is(public.acttub_purge_upload_cleanup_tombstones(10),0::bigint,'retention purge is idempotent when only referenced tombstones remain');
select ok(exists(select 1 from public.upload_intents where id='23000000-0000-0000-0090-000000000003'),'retention purge preserves referenced tombstones');
select ok(not has_function_privilege('authenticated','public.acttub_purge_upload_cleanup_tombstones(integer)','execute'),'browser cannot execute retention purge');
select * from finish();
rollback;
