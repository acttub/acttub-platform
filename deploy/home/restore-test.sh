#!/usr/bin/env bash
# 복원 CLI 데이터 대조를 격리 Postgres 18에서 검증한다. 앱/Flyway 실기동은 smoke.sh가 맡는다.
set -euo pipefail
HOME_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
PROJECT="acttub-restore-test-$$"
compose() { docker compose --project-directory "$WORK" --env-file "$WORK/.env" --env-file "$WORK/release.env" "$@"; }
cleanup() { local status=$?; compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$WORK"; return "$status"; }
trap cleanup EXIT
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
printf 'COMPOSE_PROJECT_NAME=%s\nPOSTGRES_USER=acttub\nPOSTGRES_DB=acttub\n' "$PROJECT" > "$WORK/.env"
touch "$WORK/release.env"
printf 'Schema public is up to date\n' > "$WORK/flyway-log"
cat > "$WORK/compose.yml" <<'YAML'
name: ${COMPOSE_PROJECT_NAME}
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: acttub
      POSTGRES_PASSWORD: isolated-restore-test
      POSTGRES_DB: acttub
    healthcheck:
      test: [CMD-SHELL, "pg_isready -h 127.0.0.1 -U acttub -d acttub"]
      interval: 1s
      retries: 30
    volumes:
      - data:/var/lib/postgresql
  api:
    image: postgres:18-alpine
    entrypoint: [/bin/sh, -c]
    command: ["cat /flyway-log; exec sleep infinity"]
    volumes:
      - ./flyway-log:/flyway-log:ro
    healthcheck:
      test: [CMD, /bin/true]
      interval: 1s
volumes:
  data:
YAML
compose up -d --wait db api >/dev/null
sql() { local db="$1"; shift; compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -At -F "$(printf '\t')" -U acttub -d "$db" "$@"; }
restore() { (cd "$WORK" && "$HOME_DIR/restore-db.sh" "$@"); }
manifest() { "$HOME_DIR/restore-db.sh" --manifest-sql | sql "$1"; }
sql postgres -c 'create database source'
sql source <<'SQL'
create table flyway_schema_history (installed_rank int primary key, version text);
insert into flyway_schema_history values (1, '1');
create table sample (id int primary key, note text, happened_at timestamptz, payload jsonb);
insert into sample values (1, 'private-first', '2026-09-06 09:00+09', '{"b":2,"a":1}'), (2, null, null, null);
create sequence sample_seq start 42;
create table repeated_rows (value jsonb);
insert into repeated_rows select jsonb_build_object('value', n % 31) from generate_series(1, 9000) n;
SQL
sql acttub -c 'create table original_marker (id int); insert into original_marker values (7)'
compose exec -T db pg_dump -Fc -U acttub -d source > "$WORK/source.dump"
manifest source > "$WORK/source.tsv"
grep -q '^table' "$WORK/source.tsv" || fail 'manifest에 테이블 대조가 없다'
! grep -q 'private-first' "$WORK/source.tsv" || fail 'manifest가 사용자 원문을 출력했다'
restore --counts-sql | sql source > "$WORK/counts.tsv"
# 4096행 묶음 경계를 넘는 중복 행을 반대 순서로 다시 넣어도 동일하다.
sql source <<'SQL'
begin;
create temporary table reordered as select * from repeated_rows order by value desc;
truncate repeated_rows;
insert into repeated_rows select * from reordered;
commit;
SQL
manifest source | diff "$WORK/source.tsv" - >/dev/null || fail '삽입 순서가 manifest를 바꿨다'
printf '✔ 9000행 중복 데이터의 삽입 순서에 무관한 SHA256\n'

unchanged_after_failure() {
  local out
  if out="$(restore "$WORK/source.dump" --expect "$WORK/counts.tsv" --expect-manifest "$WORK/expected.tsv" 2>&1)"; then
    fail '서로 다른 DB인데 복원을 받아들였다'
  fi
  grep -q '✗ manifest가 --expect-manifest' <<< "$out" || { printf '%s\n' "$out"; fail 'manifest 차이 이외의 이유로 실패했다'; }
  [ "$(sql acttub -c 'select id from original_marker')" = 7 ] || fail '실패가 원래 DB를 바꿨다'
  [ "$(sql postgres -c "select count(*) from pg_database where datname in ('acttub_old', 'acttub_restore')")" = 0 ] || fail '실패가 임시 DB를 남겼다'
  [ "$(compose ps --format '{{.Health}}' api)" = healthy ] || fail '실패 후 api를 복구하지 않았다'
}

sql source -c "update sample set note = 'private-changed' where id = 1"
manifest source > "$WORK/expected.tsv"
restore --counts-sql | sql source | diff "$WORK/counts.tsv" - >/dev/null || fail '반례의 행 수가 같지 않다'
unchanged_after_failure
printf '✔ 행 수가 같아도 사용자 값 차이를 rename 전에 거부\n'
sql source -c "update sample set note = 'private-first' where id = 1"
sql source -c "select setval('sample_seq', 42, true)" >/dev/null
manifest source > "$WORK/expected.tsv"
unchanged_after_failure
printf '✔ sequence is_called만 달라도 거부\n'
sql source -c "select setval('sample_seq', 42, false)" >/dev/null
sql source -c "select setval('sample_seq', 999, false)" >/dev/null
manifest source > "$WORK/expected.tsv"
unchanged_after_failure
printf '✔ sequence last_value만 달라도 거부\n'
sql source -c "select setval('sample_seq', 42, false)" >/dev/null
sql source -c 'create index changed_schema on sample (note)'
manifest source > "$WORK/expected.tsv"
unchanged_after_failure
printf '✔ 데이터가 같아도 스키마 차이를 거부\n'
sql source -c 'drop index changed_schema'
manifest source | diff "$WORK/source.tsv" - >/dev/null || fail '물리 UPDATE 뒤 같은 값을 다르게 읽었다'
restore "$WORK/source.dump" --expect "$WORK/counts.tsv" --expect-manifest "$WORK/source.tsv" --keep-old > "$WORK/restore.log" 2>&1 \
  || { cat "$WORK/restore.log"; fail '동일한 덤프 복원을 거부했다'; }
restore --manifest | diff "$WORK/source.tsv" - >/dev/null || fail '복원 후 데이터가 달라졌다'
[ "$(sql acttub_old -c 'select id from original_marker')" = 7 ] || fail '--keep-old가 원래 DB를 보존하지 않았다'
if restore "$WORK/source.dump" > "$WORK/retry.log" 2>&1; then fail 'acttub_old를 남겨 둔 재복원을 받아들였다'; fi
printf '✔ 동일한 덤프 복원 성공, --keep-old 원본 보존, 재복원 거부\n'
sql postgres -c 'drop database acttub_old with (force)'
restore "$WORK/source.dump" --expect-manifest "$WORK/source.tsv" >/dev/null
[ "$(sql postgres -c "select count(*) from pg_database where datname = 'acttub_old'")" = 0 ] || fail '기존 CLI의 old 정리가 바뀌었다'
printf '✔ 기존 CLI 성공 후 old 정리 유지\n'

# 데이터 대조를 통과한 뒤 앱/Flyway 검증에서 실패해도 swap 전 원본을 복구한다.
sql acttub -c "update sample set note = 'preserve-on-rollback' where id = 1"
restore --manifest > "$WORK/before-rollback.tsv"
printf 'No Flyway verdict\n' > "$WORK/flyway-log"
if out="$(restore "$WORK/source.dump" --expect-manifest "$WORK/source.tsv" 2>&1)"; then fail 'Flyway 판정 불가를 받아들였다'; fi
grep -q '✗ Flyway.*판정 불가' <<< "$out" || { printf '%s\n' "$out"; fail 'Flyway 외 이유로 실패했다'; }
restore --manifest | diff "$WORK/before-rollback.tsv" - >/dev/null || fail 'swap 후 실패가 원본을 복구하지 않았다'
[ "$(sql postgres -c "select count(*) from pg_database where datname = 'acttub_old'")" = 0 ] || fail 'rollback이 old 이름을 남겼다'
[ "$(compose ps --format '{{.Health}}' api)" = healthy ] || fail 'rollback 후 api를 복구하지 않았다'
printf '✔ swap 후 Flyway 판정 실패 시 원본 DB로 복구\n'

# 일부 권한/RLS로 보이지 않는 행을 전체 DB로 오인하지 않는다.
sql source <<'SQL'
create role manifest_reader;
grant usage on schema public to manifest_reader;
grant select on all tables in schema public to manifest_reader;
alter table sample enable row level security;
create policy partial_rows on sample to manifest_reader using (id = 2);
SQL
if { printf 'SET ROLE manifest_reader;\n'; "$HOME_DIR/restore-db.sh" --manifest-sql; } | sql source > "$WORK/restricted.tsv" 2> "$WORK/restricted.err"; then
  fail 'RLS가 일부 행을 숨기는 manifest를 받아들였다'
fi
grep -q 'row-level security' "$WORK/restricted.err" || { cat "$WORK/restricted.err"; fail 'RLS 외 이유로 실패했다'; }
printf '✔ RLS 필터링은 부분 결과 대신 실패\n'

cp "$WORK/.env" "$WORK/short.env"
printf 'POSTGRES_DB=%056d\n' 0 | tr '0' 'a' >> "$WORK/.env"
if out="$(restore --counts 2>&1)"; then fail '63자를 넘는 임시 DB 이름을 받아들였다'; fi
grep -q '✗ POSTGRES_DB는' <<< "$out" || { printf '%s\n' "$out"; fail 'DB 이름 길이 외 이유로 실패했다'; }
mv "$WORK/short.env" "$WORK/.env"
printf '✔ PostgreSQL 식별자 잘림을 실행 전에 거부\n'
printf 'POSTGRES_USER="acttub"\nPOSTGRES_DB='\''acttub'\''\n' >> "$WORK/.env"
restore --counts >/dev/null || fail 'Compose의 단순 인용 DB 설정을 읽지 못했다'
printf '✔ 작은따옴표·큰따옴표 DB 설정 지원\n'
