-- psql 전용. restore-db.sh --manifest-sql이 트랜잭션·출력 형식·스키마 쿼리를 함께 제공한다.
-- 사용자 값은 DB 안에서 SHA256으로 바뀐다. 행 해시를 C 로케일로 정렬하므로 삽입 순서와
-- 클러스터 로케일이 달라도 같다. 중복 행도 포함한다. 4096행 단위로 묶어 string_agg가
-- 전체 테이블 크기의 메모리를 요구하지 않게 한다(정렬은 work_mem 초과 시 디스크 사용).
SELECT 'manifest', 'sha256-jsonb-v1';
SELECT format($query$
WITH numbered AS (
    SELECT row_hash, row_number() OVER (ORDER BY row_hash COLLATE "C") AS position
    FROM (
        SELECT encode(sha256(convert_to(to_jsonb(row_value)::text, 'UTF8')), 'hex') AS row_hash
        FROM %I.%I AS row_value
    ) rows
), chunks AS (
    SELECT (position - 1) / 4096 AS chunk_number, count(*) AS rows,
           encode(sha256(convert_to(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), 'UTF8')), 'hex') AS chunk_hash
    FROM numbered
    GROUP BY (position - 1) / 4096
)
SELECT 'table', %L, coalesce(sum(rows), 0),
       encode(sha256(convert_to(coalesce(string_agg(chunk_hash, '' ORDER BY chunk_number), ''), 'UTF8')), 'hex')
FROM chunks;
$query$, n.nspname, c.relname, format('%I.%I', n.nspname, c.relname))
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname COLLATE "C"
\gexec

-- information_schema는 권한 없는 객체를 생략하므로 사용하지 않는다. 표·sequence를 읽을 수
-- 없으면 ON_ERROR_STOP으로 전체를 실패시킨다. sequence는 트랜잭션 스냅샷에 고정되지 않으므로
-- 원본 DB의 쓰기와 sequence 사용을 모두 멈춘 뒤 실행해야 한다.
SELECT format('SELECT ''sequence'', %L, last_value, is_called FROM %I.%I;',
              format('%I.%I', n.nspname, c.relname), n.nspname, c.relname)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname COLLATE "C"
\gexec
