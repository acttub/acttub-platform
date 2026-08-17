#!/usr/bin/env bash
# dr-rehearsal.sh — 재해복구 리허설. `apps/api` 를 지워도 되는지 판정한다 (SOMA-403 1단계).
#
#   apps/api-java/scripts/dr-rehearsal.sh
#
# 왜 필요한가: `apps/api` 가 사라지면 V1__baseline.sql 이 신규 환경·재해복구의 **유일한
# 스키마 생성 수단**이 된다. 그런데 FlywayBaselineTest 의 fingerprint 비교는 카탈로그의
# **정의**만 보고 다음을 보지 않는다 — V1 헤더 주석이 직접 예고해 둔 자리다.
#
#   owner · ACL · extension · sequence 의 last_value/increment/cache · 시드의 실제 값
#
# 여기서는 두 경로를 **끝까지 재현해 결과를 비교**한다. 스키마만 비교하지 않는 이유는
# 앱이 기동하며 심는 것이 따로 있기 때문이다(feature/consent/adapter/ConsentDocumentPublisher).
#
#   경로 A (지금의 dev·운영) : alembic upgrade head → FLYWAY_BASELINE_ONLY 로 baseline 기록 → 평상시 기동
#   경로 B (재해복구·신규)   : 빈 DB → 앱 기동 (Flyway 가 V1 을 적용)
#
# §B 는 데이터 복원까지 본다. §C 는 **검사기 자신을 반증한다** — 통과할 수 있는 검사는
# 통과하지 못하는 경우도 보여야 판정으로 쓸 수 있다.
#
# 필요한 것: Docker, uv, JDK. 컨테이너는 끝나면 지운다.
#
# 환경변수:
#   DR_KEEP=1        끝나고 컨테이너를 남긴다 (조사용)
#   DR_PORT          Postgres 포트 (기본 55443)
#   DR_APP_PORT      앱 기동 포트 (기본 18099)
#
# 판정 경로는 하나뿐이다 — 검사를 건너뛰는 스위치를 두지 않는다. 관문 스크립트에
# 초록으로 끝나는 길이 둘이면 그중 약한 쪽이 쓰이게 된다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAVA_ROOT="$(cd "$HERE/.." && pwd)"
API_ROOT="$(cd "$JAVA_ROOT/../api" && pwd)"

V1="$JAVA_ROOT/src/main/resources/db/migration/V1__baseline.sql"
FINGERPRINT_SQL="$JAVA_ROOT/src/test/resources/schema-fingerprint.sql"
JAR="$JAVA_ROOT/build/libs/acting-api.jar"

CONTAINER="acttub-dr-rehearsal"
PORT="${DR_PORT:-55443}"
APP_PORT="${DR_APP_PORT:-18099}"
IMAGE="postgres:18-alpine"   # 운영 RDS 와 같은 메이저 버전

# dev 의 deploy/bootstrap-dev.sh 와 같은 이름·형태다. superuser 가 아니고 DB owner 다.
APP_ROLE="acttub"
APP_PW="dr-rehearsal"

OUT="$(mktemp -d)"
FAILURES=0

# 도커 이미지는 UTC 로 뜨지만 로컬 psql 은 시스템 타임존을 따른다. 맞춰 두지 않으면
# 시각이 담긴 값의 diff 가 환경 차이로 뜬다.
export PGTZ=UTC
export PGHOST=localhost
export PGPORT="$PORT"

remove_container() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }

cleanup() {
  if [ "${DR_KEEP:-}" = "1" ]; then
    echo "  (DR_KEEP=1 — 컨테이너 $CONTAINER 를 남긴다)"
  else
    remove_container
  fi
  echo "  산출물 디렉토리: $OUT"
}
trap cleanup EXIT

ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '  ✘ %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

su_psql() { PGPASSWORD=postgres psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
as_app()  { PGPASSWORD="$APP_PW" psql -U "$APP_ROLE" -v ON_ERROR_STOP=1 "$@"; }

# ── 검사 --------------------------------------------------------------------
# 두 DB 에 같은 쿼리를 던져 결과 파일을 만들고, 같으면 0 · 다르면 1 을 준다.
# 판정은 부르는 쪽이 한다 — §C 는 **달라야** 정상인 자리라 반대 판정이 필요하다.
diff_dbs() {
  local slug="$1" left_db="$2" right_db="$3" sql="$4"
  su_psql -d "$left_db"  -tA -q -c "$sql" > "$OUT/$slug.$left_db.txt"
  su_psql -d "$right_db" -tA -q -c "$sql" > "$OUT/$slug.$right_db.txt"
  diff -u "$OUT/$slug.$left_db.txt" "$OUT/$slug.$right_db.txt" > "$OUT/$slug.diff"
}

slugify() { echo "$1" | tr ' /()·' '_____'; }

# 같아야 정상인 비교.
compare() {
  local title="$1" left_db="$2" right_db="$3" sql="$4" slug
  slug="$(slugify "$title")"
  if diff_dbs "$slug" "$left_db" "$right_db" "$sql"; then
    printf '  ✔ %-24s 같음 (%s줄)\n' "$title" \
      "$(wc -l < "$OUT/$slug.$left_db.txt" | tr -d ' ')"
  else
    printf '  ✘ %-24s 다름\n' "$title"
    sed -n '1,40p' "$OUT/$slug.diff" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# 달라야 정상인 비교 — 검사기가 차이를 실제로 잡는지 보는 자리다.
expect_differs() {
  local title="$1" left_db="$2" right_db="$3" sql="$4" slug
  slug="$(slugify "$title")"
  if diff_dbs "$slug" "$left_db" "$right_db" "$sql"; then
    fail "$title — 차이를 넣었는데 검사기가 같다고 한다"
  else
    printf '  ✔ %-24s 차이를 잡는다 (%s줄)\n' "$title" \
      "$(grep -c '^[+-][^+-]' "$OUT/$slug.diff" || true)"
  fi
}

# 비교 대상이 없는 관찰. 판정하지 않고 값을 남긴다.
observe() {
  local title="$1" db="$2" sql="$3"
  echo "  · $title — $db"
  su_psql -d "$db" -tA -q -c "$sql" | sed 's/^/      /'
}

# ── 앱 기동 ------------------------------------------------------------------
# 한 번 띄웠다 내린다. 성공하면 0, 못 뜨면 1. **판정은 부르는 쪽이 한다** —
# §C 는 못 뜨는 것이 정상인 자리다. 추가 환경변수는 뒤에 KEY=VALUE 로 붙인다.
BOOT_LOG=""
boot_app() {
  local db="$1" slug="$2"; shift 2
  local pid booted=0
  BOOT_LOG="$OUT/boot-$slug.log"

  # exec 로 바꿔치기해 JVM 이 이 셸의 직계 자식이 되게 한다. 서브셸을 한 겹 두면
  # $! 가 서브셸의 PID 라 wait 이 "not a child of this shell" 로 헛돈다.
  env "$@" \
    DATABASE_URL="postgresql://$APP_ROLE:$APP_PW@localhost:$PORT/$db" \
    JWT_SECRET=dr-rehearsal-not-a-real-key \
    AWS_REGION=ap-northeast-2 \
    DEVELOPMENT_AUTH_PROVIDER=1 \
    GEMINI_API_KEY=dr-rehearsal-not-a-real-key \
    S3_BUCKET=dr-rehearsal \
    java -Dacttub.dotenv.enabled=false -Dserver.port="$APP_PORT" \
         -jar "$JAR" > "$BOOT_LOG" 2>&1 &
  pid=$!

  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then booted=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true   # 포트를 다음 기동에 넘기기 전에 실제로 죽는다

  [ "$booted" = "1" ]
}

# 떠야 정상인 기동.
boot_expect_up() {
  local db="$1" title="$2"; shift 2
  if boot_app "$db" "$(slugify "$title")" "$@"; then
    ok "$title — 기동 성공"
  else
    fail "$title — 앱이 뜨지 못했다"
    tail -25 "$BOOT_LOG" | sed 's/^/      /'
  fi
}

# 못 떠야 정상인 기동. 로그에 기대한 사유가 있는지까지 본다.
boot_expect_down() {
  local db="$1" title="$2" expected="$3"; shift 3
  if boot_app "$db" "$(slugify "$title")" "$@"; then
    fail "$title — 떠 버렸다. 기대한 실패($expected)가 일어나지 않았다"
  elif grep -q "$expected" "$BOOT_LOG"; then
    ok "$title — 기대한 대로 못 뜬다 ($expected)"
  else
    fail "$title — 못 뜨긴 했는데 사유가 다르다. 기대: $expected"
    tail -25 "$BOOT_LOG" | sed 's/^/      /'
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
echo "▶ Postgres($IMAGE) 기동 — :$PORT"
remove_container
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
  -p "$PORT:5432" "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null

echo "▶ production-like role 준비 — $APP_ROLE (NOSUPERUSER · NOCREATEDB · NOCREATEROLE)"
su_psql -d postgres -q <<SQL
CREATE ROLE $APP_ROLE LOGIN PASSWORD '$APP_PW' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE dr_alembic       OWNER $APP_ROLE;
CREATE DATABASE dr_flyway        OWNER $APP_ROLE;
CREATE DATABASE dr_restore       OWNER $APP_ROLE;
CREATE DATABASE dr_restore_naive OWNER $APP_ROLE;
CREATE DATABASE dr_restore_noseq OWNER $APP_ROLE;
CREATE DATABASE dr_acl_probe     OWNER $APP_ROLE;
SQL

echo "▶ bootJar"
# bootJar 가 실패해도 java 는 옛 jar 로 조용히 뜬다. 먼저 지우고, 실패하면 여기서 멈춘다.
rm -f "$JAR"
(cd "$JAVA_ROOT" && ./gradlew bootJar -q --console=plain 2>&1 | tail -5 | sed 's/^/  /')
test -f "$JAR"

echo "▶ 경로 A — dr_alembic : alembic upgrade head (앱 role 로 접속)"
(
  cd "$API_ROOT/acting-api"
  DATABASE_URL="postgresql://$APP_ROLE:$APP_PW@localhost:$PORT/dr_alembic" \
  JWT_SECRET=dr-rehearsal-not-a-real-key \
    uv run alembic upgrade head 2>&1 | tail -2 | sed 's/^/  /'
)
# deploy/ssm-deploy.sh 의 be-java-baseline 모드와 같은 절차다 — baseline 만 기록하고,
# 그 뒤 평상시 설정으로 다시 띄운다.
boot_expect_up dr_alembic "경로 A baseline 기록" FLYWAY_BASELINE_ONLY=true
boot_expect_up dr_alembic "경로 A 평상시 기동"

echo "▶ 경로 B — dr_flyway : 빈 DB 에 앱을 띄워 Flyway 가 V1 을 적용하게 한다"
boot_expect_up dr_flyway "경로 B 기동"
grep -E "Migrating schema|Successfully applied" "$BOOT_LOG" | sed 's/^.*: /      /' || true

echo
echo "═══ A. 두 경로의 결과 비교 — dr_alembic vs dr_flyway ═══"

compare "fingerprint" dr_alembic dr_flyway "$(cat "$FINGERPRINT_SQL")"

compare "extension" dr_alembic dr_flyway "
SELECT e.extname || ' v' || e.extversion || ' schema=' || n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1"

# last_value 는 아직 아무도 쓰지 않은 시퀀스에서 NULL 이다. 그 상태까지 값으로 비교한다.
SEQUENCE_SQL="
SELECT sequencename
       || ' start=' || start_value || ' inc=' || increment_by
       || ' min=' || min_value || ' max=' || max_value
       || ' cache=' || cache_size || ' cycle=' || cycle
       || ' last=' || COALESCE(last_value::text, '(unused)')
FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1"
compare "sequence 상태" dr_alembic dr_flyway "$SEQUENCE_SQL"

compare "owner" dr_alembic dr_flyway "
SELECT 'SCHEMA public owner=' || pg_get_userbyid(nspowner)
FROM pg_namespace WHERE nspname = 'public'
UNION ALL
SELECT c.relkind::text || ' ' || c.relname || ' owner=' || pg_get_userbyid(c.relowner)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v', 'm')
  AND c.relname NOT IN ('flyway_schema_history', 'alembic_version')
UNION ALL
SELECT 'TYPE ' || t.typname || ' owner=' || pg_get_userbyid(t.typowner)
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e'
ORDER BY 1"

ACL_SQL="
SELECT 'SCHEMA public acl=' || COALESCE(array_to_string(nspacl, ','), '(default)')
FROM pg_namespace WHERE nspname = 'public'
UNION ALL
SELECT c.relkind::text || ' ' || c.relname || ' acl='
       || COALESCE(array_to_string(c.relacl, ','), '(default)')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v', 'm')
  AND c.relname NOT IN ('flyway_schema_history', 'alembic_version')
UNION ALL
SELECT 'DEFAULT ACL ' || defaclobjtype::text || ' role=' || pg_get_userbyid(defaclrole)
       || ' ' || COALESCE(array_to_string(defaclacl, ','), '(default)')
FROM pg_default_acl
ORDER BY 1"
compare "ACL" dr_alembic dr_flyway "$ACL_SQL"

# 어느 테이블에 몇 행이 들어갔는지. V1 의 시드도, 앱이 기동하며 심는 것도 여기 드러난다.
ROWS_QUERY="$(su_psql -d dr_alembic -tA -q -c "
  SELECT string_agg(
           format('SELECT %L || '' rows='' || count(*)::text FROM public.%I', tablename, tablename),
           ' UNION ALL ')
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('flyway_schema_history', 'alembic_version')")"
ROWS_SQL="SELECT * FROM ($ROWS_QUERY) t ORDER BY 1"
compare "테이블별 행수" dr_alembic dr_flyway "$ROWS_SQL"

# id 는 뺀다. alembic 의 0005 도 id 를 심지 않고 gen_random_uuid() 에 맡기므로
# **alembic DB 를 둘 만들어도 서로 다르다** — V1 의 결함이 아니라 원래 비결정적이다.
# ⚠ description 은 nullable 이다. COALESCE 없이 이어 붙이면 NULL 한 칸이 행 전체를
# NULL 로 만들어 **양쪽 다 빈 줄이 되고 차이가 있어도 통과**한다.
compare "시드 실제 값" dr_alembic dr_flyway "
SELECT slug || '|' || name || '|' || COALESCE(description, '(null)')
       || '|' || sort_order || '|' || is_active
FROM community_categories ORDER BY sort_order, slug"

echo
echo "  ── 다른 것이 정상인 자리 (판정하지 않고 남긴다) ──"
CATEGORY_ID_SQL="SELECT slug || ' ' || id FROM community_categories ORDER BY sort_order"
FLYWAY_HISTORY_SQL="
SELECT COALESCE(version, '-') || ' ' || description || ' type=' || type
       || ' checksum=' || COALESCE(checksum::text, '(없음)')
FROM flyway_schema_history ORDER BY installed_rank"
observe "카테고리 id" dr_alembic "$CATEGORY_ID_SQL"
observe "카테고리 id" dr_flyway "$CATEGORY_ID_SQL"
observe "flyway 이력" dr_alembic "$FLYWAY_HISTORY_SQL"
observe "flyway 이력" dr_flyway "$FLYWAY_HISTORY_SQL"

echo
echo "═══ B. 데이터 복원 — V1 로 세운 DB 에 운영 덤프를 붓는다 ═══"

echo "  · dr_alembic 에 재해 직전 상태를 만든다"
# ⚠ **시퀀스를 실제로 소비하는 행이 있어야 한다.** anomalies·coach_turns 만 bigint
# 시퀀스 PK 이고 나머지는 uuid 라, 이 둘이 비어 있으면 setval 이 덤프에서 통째로 빠져도
# "다음 id 가 비어 있다" 가 항상 참이 되어 검사가 공허해진다(§C-1 이 그것을 증명한다).
# 그래서 users → upload_intents → practice_sessions → summaries 체인을 세워 둘을 채운다.
# refresh_tokens 회전 체인은 자기참조라 pg_dump 가 "교차 참조" 로 경고하는 형태다.
su_psql -d dr_alembic -q <<'SQL'
INSERT INTO users (id, email, nickname) VALUES
  ('11111111-1111-4111-8111-111111111111', 'dr1@example.com', '리허설1'),
  ('22222222-2222-4222-8222-222222222222', 'dr2@example.com', '리허설2');

INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES
  ('44444444-4444-4444-8444-444444444444',
   '11111111-1111-4111-8111-111111111111',
   repeat('b', 64), now() + interval '30 days');
INSERT INTO refresh_tokens (id, user_id, replaced_by_id, token_hash, expires_at, revoked_at) VALUES
  ('33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444',
   repeat('a', 64), now() + interval '30 days', now());

INSERT INTO upload_intents (id, user_id, storage_provider, object_key, mime_type, size_bytes, expires_at)
VALUES ('55555555-5555-4555-8555-555555555555',
        '11111111-1111-4111-8111-111111111111',
        's3', 'dr/rehearsal.mp4', 'video/mp4', 1024, now() + interval '1 day');

INSERT INTO practice_sessions
  (id, user_id, upload_intent_id, situation, character_context, blockage_kind, sub_branch, goal)
VALUES ('66666666-6666-4666-8666-666666666666',
        '11111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555555',
        '리허설 상황', '리허설 인물', '분석', '캐릭터 분석', '리허설 목표');

INSERT INTO summaries (id, session_id, model, raw)
VALUES ('77777777-7777-4777-8777-777777777777',
        '66666666-6666-4666-8666-666666666666',
        'dr-rehearsal-model', '{}'::jsonb);

-- bigint 시퀀스를 쓰는 테이블 1: id 를 주지 않아 nextval 이 돌게 한다
INSERT INTO anomalies
  (summary_id, sort_order, start_ts, end_ts, dimension, what, why_odd,
   likely_cause, impact_on_intent, intent_impact, severity, severity_reason)
SELECT '77777777-7777-4777-8777-777777777777', g, '0:0' || g, '0:1' || g,
       '화술', '리허설 관찰 ' || g, '리허설 근거', '리허설 원인', '리허설 영향',
       '국소'::intent_impact_t, 'low'::severity_t, '리허설 사유'
FROM generate_series(1, 3) g;

INSERT INTO coach_sessions (id, summary_id, practice_session_id)
VALUES ('88888888-8888-4888-8888-888888888888',
        '77777777-7777-4777-8777-777777777777',
        '66666666-6666-4666-8666-666666666666');

-- bigint 시퀀스를 쓰는 테이블 2
INSERT INTO coach_turns (session_id, turn_index, role, text)
SELECT '88888888-8888-4888-8888-888888888888', g,
       CASE WHEN g % 2 = 1 THEN 'ai'::turn_role_t ELSE 'actor'::turn_role_t END,
       '리허설 발화 ' || g
FROM generate_series(1, 3) g;
SQL
su_psql -d dr_alembic -tA -q -c "$SEQUENCE_SQL" | sed 's/^/      /'

echo "  · pg_dump --data-only --disable-triggers"
# --disable-triggers 를 쓰는 이유가 위 자기참조다. 복원이 superuser 를 요구하게 되므로
# 재해복구는 앱 role 이 아니라 관리 role(RDS 는 rds_superuser)로 돈다.
#
# ⚠ **마이그레이션 장부 둘을 반드시 뺀다.** 두 경로의 flyway_schema_history 는 서로 다르다
# — 경로 A 는 BASELINE 한 줄(checksum 없음), 경로 B 는 V1 을 실제로 적용한 SQL 한 줄이다.
# 덤프에 담아 부으면 새 환경의 이력을 옛 환경의 것으로 덮으려다 PK 에서 깨지고,
# 설령 들어가더라도 "V1 을 적용한 적 없다"고 기록된 DB 가 된다.
DUMP="$OUT/data-only.sql"
PGPASSWORD=postgres pg_dump -U postgres -d dr_alembic \
  --data-only --disable-triggers \
  --exclude-table=alembic_version --exclude-table=flyway_schema_history \
  > "$DUMP" 2> "$OUT/pg_dump.log"
echo "      덤프 $(wc -l < "$DUMP" | tr -d ' ')줄 · setval $(grep -c 'setval' "$DUMP" || true)건"

# ── B-1. 절차를 건너뛰면 어떻게 깨지는가 (여기서 깨져야 정상이다) ──────────────
echo "  · B-1 순진한 복원 — 앱을 먼저 띄우고, 심긴 것을 그대로 둔 채 붓는다"
boot_expect_up dr_restore_naive "B-1 준비 기동"
if su_psql -d dr_restore_naive -q -f "$DUMP" > "$OUT/restore-naive.log" 2>&1; then
  fail "B-1 이 그냥 통과했다 — 이 절차의 전제(V1·앱이 심은 것과 덤프가 겹친다)가 바뀌었다"
else
  ok "B-1 예상대로 깨진다 — $(grep -o 'ERROR:.*' "$OUT/restore-naive.log" | head -1)"
fi

# ── B-2. 문서화된 절차대로 복원한다 ──────────────────────────────────────────
echo "  · B-2 절차대로 — 앱 기동으로 V1 적용 → 심긴 것을 비움 → 관리 role 로 복원 → 앱 재기동"
boot_expect_up dr_restore "B-2 준비 기동"
# V1 의 시드와 ConsentDocumentPublisher 가 심은 것을 비운다. 덤프가 같은 것을 담고 있다.
# NOTICE(CASCADE 대상 안내)만 접어 두고 오류는 그대로 드러낸다.
PGOPTIONS='-c client_min_messages=warning' \
  su_psql -d dr_restore -q -c "TRUNCATE community_categories, consent_documents CASCADE"

if su_psql -d dr_restore -q -f "$DUMP" > "$OUT/restore.log" 2>&1; then
  ok "복원 성공"
else
  fail "절차대로인데도 복원이 실패했다"
  tail -20 "$OUT/restore.log" | sed 's/^/      /'
fi

compare "복원 후 행수" dr_alembic dr_restore "$ROWS_SQL"
compare "복원 후 시퀀스" dr_alembic dr_restore "$SEQUENCE_SQL"
compare "복원 후 토큰 체인" dr_alembic dr_restore "
SELECT id || ' → ' || COALESCE(replaced_by_id::text, '(끝)') FROM refresh_tokens ORDER BY id"

# 시퀀스가 따라오지 않았다면 여기서 이미 쓰인 id 가 나온다.
next_id_is_free() {
  local db="$1" seq="$2" tbl="$3" next taken
  next="$(su_psql -d "$db" -tA -q -c "SELECT nextval('public.$seq')")"
  taken="$(su_psql -d "$db" -tA -q -c "SELECT count(*) FROM public.$tbl WHERE id = $next")"
  printf '%s %s' "$next" "$taken"
}
echo "  · 복원 후 다음 id 가 이미 쓰인 값인지 본다"
for pair in "anomalies_id_seq anomalies" "coach_turns_id_seq coach_turns"; do
  read -r next taken <<< "$(next_id_is_free dr_restore $pair)"
  if [ "$taken" = "0" ]; then
    printf '      ✔ %-16s 다음 id=%s — 비어 있다\n' "${pair#* }" "$next"
  else
    fail "${pair#* } 다음 id=$next — 이미 쓰인 값이다 (PK 충돌)"
  fi
done

# 복원된 DB 에는 동의 문서가 이미 들어 있다. 앱이 그것을 다시 발행하려다 죽지 않아야 한다.
echo "  · 복원된 DB 로 앱을 다시 띄운다"
boot_expect_up dr_restore "B-2 복원 후 기동"
observe "복원 후 동의 문서" dr_restore \
  "SELECT type || ' ' || version || ' (' || count(*) OVER () || '건)' FROM consent_documents ORDER BY type"

echo
echo "═══ C. 검사기 반증 — 틀린 것을 넣으면 실제로 걸리는가 ═══"

# ── C-1. setval 이 빠진 덤프. B 의 "다음 id" 검사가 공허하지 않음을 증명한다. ──
echo "  · C-1 덤프에서 setval 을 지우고 복원한다 (시퀀스가 안 따라온 재해복구)"
grep -v 'pg_catalog.setval' "$DUMP" > "$OUT/data-only-noseq.sql"
boot_expect_up dr_restore_noseq "C-1 준비 기동"
PGOPTIONS='-c client_min_messages=warning' \
  su_psql -d dr_restore_noseq -q -c "TRUNCATE community_categories, consent_documents CASCADE"
su_psql -d dr_restore_noseq -q -f "$OUT/data-only-noseq.sql" > "$OUT/restore-noseq.log" 2>&1

for pair in "anomalies_id_seq anomalies" "coach_turns_id_seq coach_turns"; do
  read -r next taken <<< "$(next_id_is_free dr_restore_noseq $pair)"
  if [ "$taken" = "0" ]; then
    fail "${pair#* } setval 을 지웠는데 다음 id=$next 가 비어 있다 — B 의 검사가 공허하다"
  else
    ok "${pair#* } 다음 id=$next 가 이미 쓰였다 — 검사가 PK 충돌을 실제로 잡는다"
  fi
done

# ── C-2. V1 을 고친 사본. 두 경로가 checksum 에서 갈리는 것을 재현한다. ────────
echo "  · C-2 V1 을 한 줄 고친 사본으로 두 경로를 다시 띄운다"
MUTATED="$OUT/migration-mutated"
mkdir -p "$MUTATED"
{ cat "$V1"; echo "-- dr-rehearsal: checksum 이 달라지는지 보려고 붙인 줄"; } \
  > "$MUTATED/V1__baseline.sql"

# 경로 B(V1 을 SQL 로 적용한 DB)는 checksum 이 어긋나 뜨지 못해야 한다.
boot_expect_down dr_flyway "C-2 경로 B (V1 적용본)" "Migration checksum mismatch" \
  SPRING_FLYWAY_LOCATIONS="filesystem:$MUTATED"
# 경로 A(BASELINE 만 기록된 DB)는 V1 을 적용한 적이 없어 영향을 받지 않아야 한다.
boot_expect_up dr_alembic "C-2 경로 A (baseline 기록본)" \
  SPRING_FLYWAY_LOCATIONS="filesystem:$MUTATED"

# ── C-3. ACL 을 주입한 DB. owner·ACL 비교가 차이를 잡는지 본다. ───────────────
echo "  · C-3 GRANT 를 준 DB 를 만들어 ACL 비교에 걸리는지 본다"
as_app -d dr_acl_probe -q -f "$V1"
su_psql -d dr_acl_probe -q -c "GRANT SELECT ON public.users TO PUBLIC"
expect_differs "ACL 반증" dr_flyway dr_acl_probe "$ACL_SQL"

echo
if [ "$FAILURES" = "0" ]; then
  echo "✔ 리허설 통과 — V1 만으로 세운 환경이 alembic 경로와 같고, 복원 후에도 앱이 선다"
else
  echo "✘ 리허설 실패 $FAILURES 건"
fi
exit "$FAILURES"
