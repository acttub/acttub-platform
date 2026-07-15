begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select has_index('public', 'practice_sessions', 'practice_sessions_visible_owner_created_id_idx', 'visible owner keyset index exists');
select has_function('public', 'acttub_list_owned_practice_session_summaries', array['uuid','integer','timestamp with time zone','timestamp with time zone','uuid'], 'summary RPC exists');
select ok(position('search_path=pg_catalog, public' in coalesce((select array_to_string(proconfig, ',') from pg_proc where oid='public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)'::regprocedure),'')) > 0, 'fixed search path');
select ok(not has_function_privilege('anon', 'public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)', 'execute'), 'anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)', 'execute'), 'authenticated cannot execute');
select ok(has_function_privilege('service_role', 'public.acttub_list_owned_practice_session_summaries(uuid,integer,timestamptz,timestamptz,uuid)', 'execute'), 'service role can execute');

update public.upload_quota_policy set max_active_intents=100, max_active_bytes=1000000;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('24000000-0000-4000-8000-000000000001','authenticated','authenticated','list-one@example.com',now(),now()),
 ('24000000-0000-4000-8000-000000000002','authenticated','authenticated','list-two@example.com',now(),now());
insert into public.profiles(id,email,status) values
 ('24000000-0000-4000-8000-000000000001','list-one@example.com','pending_terms'),
 ('24000000-0000-4000-8000-000000000002','list-two@example.com','pending_terms');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,finalized_at,consumed_at)
select
 ('24000000-0000-4000-8100-'||lpad(gs::text,12,'0'))::uuid,
 '24000000-0000-4000-8000-000000000001'::uuid,
 ('24000000-0000-4000-8200-'||lpad(gs::text,12,'0'))::uuid,
 'finalized',
 'users/24000000-0000-4000-8000-000000000001/practice-sessions/24000000-0000-4000-8200-'||lpad(gs::text,12,'0')||'/take.mp4',
 'video/mp4', 10, clock_timestamp(), clock_timestamp()
from generate_series(1,25) gs;

insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,hidden_at,created_at,updated_at)
select
 ('24000000-0000-4000-8200-'||lpad(gs::text,12,'0'))::uuid,
 '24000000-0000-4000-8000-000000000001'::uuid,
 ('24000000-0000-4000-8100-'||lpad(gs::text,12,'0'))::uuid,
 case when gs%2=0 then 'analyzing' else 'observations_pending' end,
 case when gs%2=0 then 'acting-api-v1' else 'legacy-gemini-v1' end,
 '기타', '드라마',
 case when gs in (1,2) then repeat('😀',300) else '장면 '||gs end,
 '인물', '의도',
 case when gs=25 then clock_timestamp() else null end,
 case when gs in (10,11,12) then '2026-01-01 00:00:10+00'::timestamptz else '2026-01-01 00:00:00+00'::timestamptz + (gs||' seconds')::interval end,
 '2026-01-02 00:00:00+00'::timestamptz
from generate_series(1,25) gs;

insert into public.practice_takes(id,session_id,user_id,storage_path,mime_type,size_bytes,duration_ms,analysis_status,analysis_retryable)
select
 ('24000000-0000-4000-8300-'||lpad(gs::text,12,'0'))::uuid,
 ('24000000-0000-4000-8200-'||lpad(gs::text,12,'0'))::uuid,
 '24000000-0000-4000-8000-000000000001'::uuid,
 'users/24000000-0000-4000-8000-000000000001/practice-sessions/24000000-0000-4000-8200-'||lpad(gs::text,12,'0')||'/take.mp4',
 'video/mp4',10,1000,
 case when gs%2=0 then 'completed' else 'generated' end,
 false
from generate_series(1,25) gs;

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,finalized_at,consumed_at) values
 ('24000000-0000-4000-9100-000000000001','24000000-0000-4000-8000-000000000002','24000000-0000-4000-9200-000000000001','finalized','users/24000000-0000-4000-8000-000000000002/practice-sessions/24000000-0000-4000-9200-000000000001/take.mp4','video/mp4',10,clock_timestamp(),clock_timestamp());
insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at) values
 ('24000000-0000-4000-9200-000000000001','24000000-0000-4000-8000-000000000002','24000000-0000-4000-9100-000000000001','analyzing','acting-api-v1','기타','드라마','다른 소유자','인물','의도','2026-01-01 00:01:00+00','2026-01-02 00:00:00+00');

create temporary table page_one as select * from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',6);
create temporary table emitted_one as select * from page_one order by created_at desc,id desc limit 5;
select is((select count(*) from page_one),6::bigint,'limit plus one rows are returned as a sentinel page');
select is((select count(*) from emitted_one),5::bigint,'public page emits only requested limit');
select is((select count(distinct snapshot_at) from page_one),1::bigint,'one database snapshot is shared by the page');
select ok(not exists(select 1 from page_one where id='24000000-0000-4000-8200-000000000025'),'hidden row is absent');
select ok(not exists(select 1 from page_one where id='24000000-0000-4000-9200-000000000001'),'other owner row is absent');
select ok(exists(select 1 from page_one where legacy) and exists(select 1 from page_one where not legacy),'legacy and acting summaries share one ordered page');
select is((select max(char_length(title)) from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26)),120,'title is bounded to 120 code points');
select is((select max(char_length(preview)) from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26)),240,'preview is bounded to 240 code points including astral emoji');
select is((select title from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26) where id='24000000-0000-4000-8200-000000000001'),'드라마','legacy title preserves genre-first card parity');
select is((select preview from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26) where id='24000000-0000-4000-8200-000000000003'),'장면 3','legacy preview preserves situation fallback');
select is((select array_agg(id order by created_at desc,id desc) from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26) where created_at='2026-01-01 00:00:10+00'),array['24000000-0000-4000-8200-000000000012','24000000-0000-4000-8200-000000000011','24000000-0000-4000-8200-000000000010']::uuid[],'equal timestamps use id descending order');

create temporary table page_two as
select * from public.acttub_list_owned_practice_session_summaries(
 '24000000-0000-4000-8000-000000000001',6,
 (select snapshot_at from page_one limit 1),
 (select created_at from emitted_one order by created_at,id limit 1),
 (select id from emitted_one order by created_at,id limit 1));
select is((select count(*) from emitted_one e join page_two p using(id)),0::bigint,'keyset pages have no duplicate ids');
select is((select snapshot_at from page_two limit 1),(select snapshot_at from page_one limit 1),'page two preserves the original database snapshot');
select is((select count(*) from (select id from emitted_one union select id from page_two) x),11::bigint,'page boundary has no omission before the second sentinel');
select ok(not exists(
  select 1 from page_two p
  where (p.created_at,p.id) >= (select e.created_at,e.id from emitted_one e order by e.created_at,e.id limit 1)
),'second page begins strictly after last emitted key');
select is((select count(*) from information_schema.columns where table_schema like 'pg_temp%' and table_name='page_one'),11::bigint,'result exposes only eleven scalar summary columns');
select ok(not exists(select 1 from information_schema.columns where table_schema like 'pg_temp%' and table_name='page_one' and data_type in ('json','jsonb','array')),'result contains no nested detail columns');

insert into public.upload_intents(id,user_id,session_id,status,expected_storage_path,expected_mime_type,expected_size_bytes,finalized_at,consumed_at) values
 ('24000000-0000-4000-a100-000000000001','24000000-0000-4000-8000-000000000001','24000000-0000-4000-a200-000000000001','finalized','users/24000000-0000-4000-8000-000000000001/practice-sessions/24000000-0000-4000-a200-000000000001/take.mp4','video/mp4',10,clock_timestamp(),clock_timestamp());
insert into public.practice_sessions(id,user_id,upload_intent_id,status,pipeline_version,medium,genre,situation,character_context,subtext,created_at,updated_at) values
 ('24000000-0000-4000-a200-000000000001','24000000-0000-4000-8000-000000000001','24000000-0000-4000-a100-000000000001','analyzing','acting-api-v1','기타','드라마','페이지 뒤 신규','인물','의도',clock_timestamp(),clock_timestamp());
select ok(not exists(select 1 from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26,(select snapshot_at from page_one limit 1)) where id='24000000-0000-4000-a200-000000000001'),'post-page-one insert is excluded from original snapshot');
select ok(exists(select 1 from public.acttub_list_owned_practice_session_summaries('24000000-0000-4000-8000-000000000001',26) where id='24000000-0000-4000-a200-000000000001'),'fresh first page includes the new session');

select throws_ok($$select * from public.acttub_list_owned_practice_session_summaries(gen_random_uuid(),1)$$, 'P0001', 'invalid_limit', 'limit must include sentinel');
select throws_ok($$select * from public.acttub_list_owned_practice_session_summaries(null,2)$$, 'P0001', 'user_id_required', 'null owner fails closed');
select throws_ok($$select * from public.acttub_list_owned_practice_session_summaries(gen_random_uuid(),52)$$, 'P0001', 'invalid_limit', 'limit above maximum fails closed');
select throws_ok($$select * from public.acttub_list_owned_practice_session_summaries(gen_random_uuid(),2,null,now(),null)$$, 'P0001', 'incomplete_keyset', 'keyset is all-or-none');
select throws_ok($$select * from public.acttub_list_owned_practice_session_summaries(gen_random_uuid(),2,now(),now()+interval '1 second',gen_random_uuid())$$, 'P0001', 'keyset_after_snapshot', 'keyset cannot exceed snapshot');

select * from finish();
rollback;
