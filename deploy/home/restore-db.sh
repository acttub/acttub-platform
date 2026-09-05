#!/usr/bin/env bash
# 홈서버 DB 복원 스크립트(SOMA-489). pg_dump -Fc 파일을 이 프로젝트의 db 컨테이너에 복원한다 —
# dev 이전(dev EC2 덤프)·백업 복원 연습(S3 백업)·운영 컷오버(RDS 덤프)가 같은 길을 쓴다.
# deploy.sh 처럼 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다. 스택이 한 번은 deploy.sh 로 떠 있어야 한다
# (release.env 가 있어야 compose 가 파일을 읽는다). 새 볼륨이면 먼저 deploy.sh — Flyway 가 거기 만든 빈 스키마는
# 여기서 통째로 바뀐다.
#
#   cd /svc/acttub/dev
#   ./restore-db.sh <덤프>                        복원 → api 재기동 → Flyway 가 새로 적용한 것이 없는지 확인
#   ./restore-db.sh <덤프> --expect <행 수 파일>   복원 직후 테이블별 행 수를 파일과 대조 — 다르면 실패·되돌림
#   ./restore-db.sh <덤프> --expect-manifest <파일>   행 내용·sequence 값·스키마를 이름 변경 전에 대조
#   ./restore-db.sh <덤프> --keep-old             성공 후에도 <db>_old를 보존한다(정리 전 다음 복원은 거부)
#   ./restore-db.sh <덤프> --allow-migrate        덤프가 앱보다 오래돼 Flyway 가 마이그레이션을 새로 적용해도 받는다
#                                                   (옛 백업에서 복구할 때. 이전·컷오버에서는 쓰지 않는다)
#   ./restore-db.sh --counts                      복원 없이 지금 DB 의 "테이블<TAB>행 수" 만 출력
#   ./restore-db.sh --counts-sql                  그 SQL 만 출력 — 원본 DB 에서 같은 표를 뽑을 때:
#                                                   ./restore-db.sh --counts-sql | psql "$URL" -At -F $'\t' > source-counts.tsv
#   ./restore-db.sh --manifest                    지금 DB의 테이블 행 수·SHA256, sequence, 스키마 출력
#   ./restore-db.sh --manifest-sql                원본 psql용 SQL 출력(사용자 원문은 출력하지 않는다):
#                                                   ./restore-db.sh --manifest-sql | psql "$URL" -X -q -v ON_ERROR_STOP=1 -At -F $'\t' > source-manifest.tsv
#      원본의 모든 쓰기·sequence 사용을 멈춘 뒤 덤프와 manifest를 만든다. 테이블은 한 스냅샷으로 읽지만
#      sequence는 트랜잭션으로 고정되지 않는다. 역할·권한·함수·RLS 정책은 별도 이전 목록으로 대조한다.
#
# 하는 일 — 어느 단계든 실패하면 exit≠0 이고, 원래 DB 를 제자리에 둔 채 api 를 다시 올린다(예외는 5 의 마지막 정리뿐)
#   1. api 를 멈춘다(DB 연결을 끊고 복원 중 쓰기를 막는다). web·cloudflared 는 그대로라 그동안 /v2 는 502 다.
#   2. 새 DB <db>_restore 를 만들어(template0, 컨테이너 클러스터의 기본 로케일) 거기에 pg_restore 한다.
#      --no-owner --no-privileges   소유자는 접속 역할(POSTGRES_USER)로 통일하고 원본의 GRANT 는 가져오지 않는다
#                                   (RDS 덤프의 rds_superuser 처럼 이 클러스터에 없는 역할이 걸리지 않게)
#      --exit-on-error --single-transaction   하나라도 실패하면 전부 취소
#      덤프는 stdin 으로 흘린다 — 컨테이너에 파일을 두지 않는다.
#   3. 복원된 DB 에 flyway_schema_history 가 있어야 한다(없으면 api 가 V1 부터 적용하려다 죽는다).
#      --expect 가 있으면 테이블별 행 수를 그 파일과 diff 한다. 다르면 실패.
#   4. 바꿔치기: <db> → <db>_old, <db>_restore → <db>. api 를 올려 healthy 를 기다리고 Flyway 로그를 본다 —
#      같은 앱 버전의 덤프면 "up to date" 다. 마이그레이션을 새로 적용했으면(Successfully applied) 덤프가 앱보다
#      낡은 것이라 실패로 되돌린다(이전·컷오버라면 덤프를 다시 뜬다). 옛 백업에서 복구하는 것이면 --allow-migrate 로
#      허용한다. 둘 다 없으면 판정 불가로 실패.
#   5. 성공하면 <db>_old 를 지운다(--keep-old면 보존. 정리만 실패하면 복원은 끝난 상태라 되돌리지 않는다).
#      4 에서 실패하면 <db> 를 지우고 <db>_old 를 <db> 로 되돌린 뒤 api 를 올린다.
#      <db>_old 가 남은 채 시작되면(이전 실행이 중간에 죽음) 어느 쪽이 진짜 데이터인지 사람이 봐야 하므로 멈춘다.
#
# --clean 으로 기존 DB 위에 덮어쓰지 않는 이유: 대상에만 있는 객체가 남아 "덤프와 같은 DB" 라는 보장이 없고, 실패하면
# 반쯤 지워진 DB 가 남는다. 새 DB 에 복원한 뒤 이름을 바꾸면 실패해도 원본이 그대로다.
# --create 로 DB 를 만들지 않는 이유: 덤프의 로케일(dev EC2 는 C.UTF-8)이 이 컨테이너(en_US.utf8)에 없을 수 있다.
# 클러스터 기본 로케일로 만든다 — Flyway 가 빈 볼륨에 만드는 DB 와 같은 조건이다.
set -euo pipefail

step() { printf '▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
# --help 는 위 머리 주석 전체를 보여 준다(shebang 다음 줄부터 첫 빈 줄까지) — 행 번호를 적어 두지 않는다.
usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

# 테이블별 정확한 행 수(count(*), 통계 추정치가 아니다). 원본 DB 와 복원 결과를 같은 SQL 로 뽑아 diff 한다.
# Postgres 16(dev EC2)·18(컨테이너) 양쪽에서 돈다.
COUNTS_SQL="select table_name, (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1;"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
manifest_sql() {
  local schema_sql="$SCRIPT_DIR/schema-fingerprint.sql"
  [ -f "$schema_sql" ] || schema_sql="$SCRIPT_DIR/../../apps/api/src/test/resources/schema-fingerprint.sql"
  [ -r "$SCRIPT_DIR/db-manifest.sql" ] || fail "db-manifest.sql이 없다: $SCRIPT_DIR"
  [ -r "$schema_sql" ] || fail "기존 schema-fingerprint.sql이 없다: $SCRIPT_DIR"
  cat <<'SQL'
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'postgres';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
SET LOCAL search_path = public, pg_catalog;
SQL
  cat "$SCRIPT_DIR/db-manifest.sql"
  printf '\nSELECT '\''schema'\'', line FROM (\n'
  cat "$schema_sql"
  printf '\n) source_fingerprint ORDER BY line COLLATE "C";\nCOMMIT;\n'
}

MODE=restore DUMP="" EXPECT="" EXPECT_MANIFEST="" ALLOW_MIGRATE=0 KEEP_OLD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --counts) MODE=counts ;;
    --counts-sql) printf '%s\n' "$COUNTS_SQL"; exit 0 ;;
    --manifest) MODE=manifest ;;
    --manifest-sql) manifest_sql; exit 0 ;;
    --expect) shift; EXPECT="${1:-}"; [ -n "$EXPECT" ] || fail "--expect 뒤에 행 수 파일이 없다" ;;
    --expect-manifest) shift; EXPECT_MANIFEST="${1:-}"; [ -n "$EXPECT_MANIFEST" ] || fail "--expect-manifest 뒤에 파일이 없다" ;;
    --allow-migrate) ALLOW_MIGRATE=1 ;;
    --keep-old) KEEP_OLD=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) fail "모르는 옵션: $1 (사용법: restore-db.sh --help)" ;;
    *) [ -z "$DUMP" ] || fail "덤프 파일은 하나만: '$DUMP' 와 '$1'"; DUMP="$1" ;;
  esac
  shift
done

WAIT_SECONDS="${RESTORE_WAIT_SECONDS:-180}"
[[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] || fail "RESTORE_WAIT_SECONDS 는 초 단위 정수: '$WAIT_SECONDS'"
[ -f compose.yml ] || fail "compose.yml 이 없다 — 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다: $PWD"
[ -f .env ] || fail ".env 가 없다 — 사람이 채우는 파일이다(deploy/home/.env.example): $PWD"
[ -f release.env ] || fail "release.env 가 없다 — 스택을 먼저 deploy.sh 로 한 번 올린다: $PWD"
command -v docker >/dev/null || fail "docker 가 없다"
docker compose version >/dev/null 2>&1 || fail "docker compose 가 없다"

# compose.yml 의 db 서비스·api 의 DATABASE_URL 과 같은 기본값(acttub). .env 가 덮으면 그 값을 따른다.
# 값은 SQL 식별자에 그대로 들어가므로 소문자·숫자·밑줄만 받는다(따옴표·공백이 끼어들 길을 막는다).
env_value() {
  local v
  v="$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' || true)"
  # 식별자만 받으므로 shell로 실행하거나 변수 확장하지 않는다. Compose의 단순 인용 값은 허용한다.
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "${v:-$2}"
}
PGUSER="$(env_value POSTGRES_USER acttub)"
PGDB="$(env_value POSTGRES_DB acttub)"
[[ "$PGUSER" =~ ^[a-z_][a-z0-9_]*$ ]] || fail ".env 의 POSTGRES_USER 는 소문자·숫자·밑줄만: '$PGUSER'"
[[ "$PGDB" =~ ^[a-z_][a-z0-9_]*$ ]] || fail ".env 의 POSTGRES_DB 는 소문자·숫자·밑줄만: '$PGDB'"
[ "${#PGUSER}" -le 63 ] || fail "POSTGRES_USER는 63자 이하여야 한다"
[ "${#PGDB}" -le 55 ] || fail "POSTGRES_DB는 _restore 접미사를 포함해 63자 이하여야 한다(기본 이름 최대 55자)"
RESTORE_DB="${PGDB}_restore"
OLD_DB="${PGDB}_old"

compose() { docker compose --env-file .env --env-file release.env "$@"; }
# psql_in <DB> <psql 인자...> — db 컨테이너 안의 psql(유닉스 소켓, 비밀번호 불필요). 오류에서 멈추고 탭 구분 무장식 출력.
psql_in() { local db="$1"; shift; compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -At -F "$(printf '\t')" -U "$PGUSER" -d "$db" "$@"; }
db_exists() { [ "$(psql_in postgres -c "select 1 from pg_database where datname = '$1'")" = "1" ]; }

if [ "$MODE" = counts ]; then
  psql_in "$PGDB" -c "$COUNTS_SQL"
  exit 0
fi
if [ "$MODE" = manifest ]; then
  manifest_sql | psql_in "$PGDB"
  exit 0
fi

[ -n "$DUMP" ] || fail "덤프 파일이 없다 (사용법: restore-db.sh <덤프> [--expect <행 수 파일>])"
[ -s "$DUMP" ] || fail "덤프 파일이 없거나 비어 있다: $DUMP"
[ -z "$EXPECT" ] || [ -f "$EXPECT" ] || fail "--expect 파일이 없다: $EXPECT"
[ -z "$EXPECT_MANIFEST" ] || [ -s "$EXPECT_MANIFEST" ] || fail "--expect-manifest 파일이 없거나 비었다: $EXPECT_MANIFEST"
# 필요한 SQL이 없으면 api를 멈추기 전에 실패한다.
if [ -n "$EXPECT_MANIFEST" ]; then manifest_sql >/dev/null; fi

# ── 실패 처리 — 어느 단계에서 죽든 원래 DB 를 제자리에 두고 api 를 다시 올린다 ──────
API_STOPPED=0
SWAP_STARTED=0
SWAP_ACCEPTED=0
restart_api() {
  step "api 를 원래 DB($PGDB)로 다시 올린다"
  if compose up -d --wait --wait-timeout "$WAIT_SECONDS" api >/dev/null; then API_STOPPED=0
  else echo "⚠ api 가 다시 healthy 가 되지 않았다 — compose ps 와 compose logs api 를 본다" >&2
  fi
}
# give_up <이유> — 바꿔치기 전 실패: 복원 중이던 DB 만 지우고 api 를 원래 DB 로 올린 뒤 실패로 끝낸다.
give_up() {
  psql_in postgres -c "drop database if exists \"$RESTORE_DB\" with (force)" >/dev/null 2>&1 || true
  restart_api
  fail "$@"
}
# rename_back — 복원본(<db>)을 버리고 <db>_old 를 <db> 로 되돌린다. <db> 가 없는 상태(첫 rename 뒤 실패)에서도 된다.
rename_back() {
  # old를 확인하지 못했을 때 현재 DB를 지우지 않는다.
  if ! db_exists "$OLD_DB"; then
    echo "⚠ $OLD_DB를 확인하지 못해 자동 되돌리기를 멈췄다 — DB 상태를 직접 확인한다" >&2
    return 1
  fi
  psql_in postgres -c "drop database if exists \"$PGDB\" with (force)" \
                   -c "alter database \"$OLD_DB\" rename to \"$PGDB\"" >/dev/null 2>&1 \
    || { echo "⚠ 되돌리기 실패 — $OLD_DB 가 원래 데이터다. 손으로: alter database $OLD_DB rename to $PGDB" >&2; return 1; }
  SWAP_STARTED=0
}
# rollback_swap <이유> — 바꿔치기 뒤 실패: 복원본을 버리고 옛 DB 를 제자리로 돌린 뒤 api 를 올리고 실패로 끝낸다.
rollback_swap() {
  compose stop api >/dev/null 2>&1 || true
  rename_back || fail "$* — 자동 되돌리기 실패; api를 멈춘 채 남긴다"
  restart_api
  fail "$@"
}
# 예기치 않은 오류·종료 신호도 이름 변경 중이면 원본 이름을 복구한 뒤 api를 올린다.
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$SWAP_STARTED" = 1 ] && [ "$SWAP_ACCEPTED" = 0 ]; then
    compose stop api >/dev/null 2>&1 || true
    if ! rename_back; then
      echo "⚠ 원본 DB 복구가 확인되지 않아 api는 정지 상태로 남긴다" >&2
      return 0
    fi
    psql_in postgres -c "drop database if exists \"$RESTORE_DB\" with (force)" >/dev/null 2>&1 || true
    API_STOPPED=1
  fi
  if [ "$status" -ne 0 ] && [ "$API_STOPPED" = 1 ]; then
    echo "⚠ 예기치 않은 오류로 끝났다 — api 를 다시 올린다(기다리지 않음). compose ps 로 확인한다" >&2
    compose up -d api >/dev/null 2>&1 || echo "⚠ api 를 올리지 못했다 — compose ps 와 compose logs api 를 본다" >&2
  fi
  return 0
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── 준비: db healthy, 이전 실행의 잔해 확인, api 정지 ─────────────────────────────
step "db 가 healthy 인지 본다 (compose up -d --wait db)"
compose up -d --wait --wait-timeout "$WAIT_SECONDS" db >/dev/null || fail "db 가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다"

if db_exists "$OLD_DB"; then
  fail "$OLD_DB 가 남아 있다 — --keep-old로 보존했거나 이전 실행이 중단됐다. 어느 쪽이 맞는지 확인하고 정리한 뒤 다시 한다: \
$( db_exists "$PGDB" && printf '%s 가 복원본, %s 가 그 전 데이터다' "$PGDB" "$OLD_DB" || printf '%s 가 없다 — alter database %s rename to %s 로 되돌린다' "$PGDB" "$OLD_DB" "$PGDB")"
fi
db_exists "$PGDB" || fail "$PGDB 가 없다 — compose 의 POSTGRES_DB(.env)와 db 볼륨이 맞는지 본다"

step "api 를 멈춘다 (복원 중 DB 연결·쓰기 차단 — web 은 그대로, 그동안 /v2 는 502)"
compose stop api
API_STOPPED=1

# ── 2. 새 DB 에 복원 ────────────────────────────────────────────────────────────
step "$RESTORE_DB 를 새로 만든다 (template0, 클러스터 기본 로케일, owner $PGUSER)"
psql_in postgres -c "drop database if exists \"$RESTORE_DB\" with (force)" \
                 -c "create database \"$RESTORE_DB\" owner \"$PGUSER\" template template0" \
  || give_up "$RESTORE_DB 를 만들지 못했다"

step "pg_restore → $RESTORE_DB (stdin, --no-owner --no-privileges --exit-on-error --single-transaction)"
compose exec -T db pg_restore -U "$PGUSER" -d "$RESTORE_DB" \
    --no-owner --no-privileges --exit-on-error --single-transaction < "$DUMP" \
  || give_up "pg_restore 가 실패했다 — 위 오류를 본다. 원래 DB 는 그대로다"

# ── 3. 복원 결과 검사: Flyway 이력·행 수 ─────────────────────────────────────────
step "복원된 DB 의 테이블별 행 수"
counts="$(psql_in "$RESTORE_DB" -c "$COUNTS_SQL")" || give_up "복원된 DB 에서 행 수를 읽지 못했다"
printf '%s\n' "$counts" | sed 's/^/  /'
tables="$(printf '%s\n' "$counts" | awk 'NF { n++ } END { print n + 0 }')"
[ "$tables" -gt 0 ] || give_up "복원된 DB 에 테이블이 없다 — 덤프가 비었거나 다른 스키마다"
# grep -q 는 발견 즉시 종료하므로 printf 파이프 대신 <<< 를 쓴다. 큰 출력에서도 SIGPIPE 를 피한다.
grep -q "$(printf '^flyway_schema_history\t')" <<< "$counts" \
  || give_up "복원된 DB 에 flyway_schema_history 가 없다 — 이력 없는 덤프는 받지 않는다(api 가 V1 부터 다시 적용하려다 죽는다)"
if [ -n "$EXPECT" ]; then
  if ! d="$(printf '%s\n' "$counts" | diff "$EXPECT" -)"; then
    printf '%s\n' "$d" >&2
    give_up "행 수가 --expect $EXPECT 와 다르다 (위 diff — '<' 기대, '>' 복원 결과)"
  fi
  echo "  --expect $EXPECT 와 일치 (테이블 ${tables}개)"
fi
if [ -n "$EXPECT_MANIFEST" ]; then
  step "행 내용·sequence·스키마 manifest를 이름 변경 전에 대조한다"
  manifest="$(manifest_sql | psql_in "$RESTORE_DB")" || give_up "복원된 DB의 manifest를 읽지 못했다"
  if ! d="$(printf '%s\n' "$manifest" | diff "$EXPECT_MANIFEST" -)"; then
    printf '%s\n' "$d" >&2
    give_up "manifest가 --expect-manifest $EXPECT_MANIFEST 와 다르다 (위 diff — '<' 기대, '>' 복원 결과)"
  fi
  echo "  --expect-manifest $EXPECT_MANIFEST 와 일치"
fi

# ── 4. 바꿔치기 → api 기동 → Flyway ────────────────────────────────────────────
step "바꿔치기: $PGDB → $OLD_DB, $RESTORE_DB → $PGDB"
# 남은 연결(백업 사이드카 등)이 있으면 RENAME 이 거부된다 — 먼저 끊는다. FORCE 옵션은 DROP 에만 있다.
psql_in postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$PGDB', '$RESTORE_DB') and pid <> pg_backend_pid()" >/dev/null || true
psql_in postgres -c "alter database \"$PGDB\" rename to \"$OLD_DB\"" \
  || give_up "$PGDB 의 이름을 바꾸지 못했다 — 아직 연결이 남아 있는지 본다(pg_stat_activity)"
SWAP_STARTED=1
if ! psql_in postgres -c "alter database \"$RESTORE_DB\" rename to \"$PGDB\""; then
  rename_back || fail "$RESTORE_DB 이름 변경과 원본 복구가 실패했다"
  give_up "$RESTORE_DB 를 $PGDB 로 바꾸지 못했다"
fi

LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
step "api 를 올리고 healthy 를 기다린다 (최대 ${WAIT_SECONDS}초 — Flyway 검증·Hibernate validate 가 이 안에서 돈다)"
if ! compose up -d --wait --wait-timeout "$WAIT_SECONDS" api; then
  compose logs --no-color --since "$LOG_SINCE" --tail 60 api || true
  rollback_swap "복원된 DB 로 api 가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다 — 위 로그를 본다. 옛 DB 로 되돌렸다"
fi
API_STOPPED=0

step "Flyway 로그 — 이력이 덤프와 함께 왔으면 'up to date' 다"
flyway="$(compose logs --no-color --since "$LOG_SINCE" api | grep -E 'Migrating schema|Successfully (applied|validated)|is up to date|Current version of schema|baseline' || true)"
printf '%s\n' "$flyway" | sed 's/^/  /'
if grep -q 'is up to date' <<< "$flyway"; then
  verdict="up to date"
elif grep -q 'Successfully applied' <<< "$flyway"; then
  verdict="$(printf '%s\n' "$flyway" | grep -oE 'Successfully applied [0-9]+ migrations?' | tail -1)"
  [ "$ALLOW_MIGRATE" = 1 ] \
    || rollback_swap "Flyway 가 마이그레이션을 새로 적용했다($verdict) — 덤프가 앱보다 낡았다. 이전·컷오버라면 덤프를 다시 뜬다. 옛 백업에서 복구하는 것이면 --allow-migrate 로 다시 돌린다. 옛 DB 로 되돌렸다"
  echo "⚠ 덤프가 앱보다 오래돼 Flyway 가 마이그레이션을 새로 적용했다($verdict) — --allow-migrate 로 허용됨" >&2
else
  rollback_swap "Flyway 의 'up to date' 도 'Successfully applied' 도 없다 — 판정 불가. 옛 DB 로 되돌렸다"
fi

# ── 5. 마무리 ──────────────────────────────────────────────────────────────────
SWAP_ACCEPTED=1
if [ "$KEEP_OLD" = 1 ]; then
  printf '✔ 복원 완료 — %s ← %s (테이블 %s개, Flyway %s), 원본 %s 보존\n' "$PGDB" "$DUMP" "$tables" "$verdict" "$OLD_DB"
  exit 0
fi
step "$OLD_DB 를 지운다"
psql_in postgres -c "drop database if exists \"$OLD_DB\" with (force)" >/dev/null \
  || fail "복원은 끝났지만(api 는 $PGDB 로 떠 있다) $OLD_DB 를 지우지 못했다 — 손으로: drop database $OLD_DB with (force). 지우기 전에는 다음 복원이 시작을 거부한다"
printf '✔ 복원 완료 — %s ← %s (테이블 %s개, Flyway %s)\n' "$PGDB" "$DUMP" "$tables" "$verdict"
