-- dev DB에서 쉬지 않는 연결의 대기 이벤트와 쿼리를 0.2초마다 찍는다. ab-guc.sh 가 psql -f - 로 넘긴다.
\pset footer off
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'
select round(extract(epoch from clock_timestamp())::numeric,3), pid, state, coalesce(wait_event_type,'-'), coalesce(wait_event,'-'), round(extract(epoch from clock_timestamp()-xact_start)*1000), round(extract(epoch from clock_timestamp()-query_start)*1000), pg_blocking_pids(pid)::text, left(regexp_replace(query,'\s+',' ','g'),90) from pg_stat_activity where datname=current_database() and state<>'idle' and pid<>pg_backend_pid() and backend_type='client backend' \watch 0.2
