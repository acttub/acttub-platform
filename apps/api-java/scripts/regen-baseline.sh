#!/usr/bin/env bash
# V1__baseline.sql 과 alembic-schema-fingerprint.txt 를 현재 alembic HEAD 기준으로 다시 만든다.
#
#   apps/api-java/scripts/regen-baseline.sh
#
# 왜 필요한가: 두 파일은 alembic 결과의 스냅샷이다. `apps/api` 에 마이그레이션이 추가되면
# 둘 다 낡는데, FlywayBaselineTest 는 이 둘을 서로 비교하므로 **낡아도 초록이 뜬다**.
# 스키마가 바뀌는 PR 마다 이 스크립트를 돌리고 결과를 커밋해야 한다.
#
# 필요한 것: Docker, uv. 컨테이너는 끝나면 지운다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAVA_ROOT="$(cd "$HERE/.." && pwd)"
API_ROOT="$(cd "$JAVA_ROOT/../api" && pwd)"

V1="$JAVA_ROOT/src/main/resources/db/migration/V1__baseline.sql"
FINGERPRINT="$JAVA_ROOT/src/test/resources/alembic-schema-fingerprint.txt"
FINGERPRINT_SQL="$JAVA_ROOT/src/test/resources/schema-fingerprint.sql"

CONTAINER="acttub-baseline-regen"
PORT="${REGEN_PORT:-55441}"
IMAGE="postgres:18-alpine"   # 운영 RDS 와 같은 메이저 버전

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▶ Postgres($IMAGE) 기동"
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=regen -e POSTGRES_USER=regen -e POSTGRES_DB=regen \
  -p "$PORT:5432" "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U regen >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U regen >/dev/null

echo "▶ alembic upgrade head"
(
  cd "$API_ROOT/acting-api"
  DATABASE_URL="postgresql://regen:regen@localhost:$PORT/regen" JWT_SECRET=regen \
    uv run alembic upgrade head 2>&1 | tail -3
)

echo "▶ alembic 결과 DB에서 시드 행 추출"
# 정본은 0005의 _SEED_CATEGORIES다. alembic을 실제로 적용한 DB에서 네 필드를 읽으므로
# 기존 V1을 복사해 둘이 같이 낡는 자기참조가 생기지 않는다.
SEED_ROWS="$(docker exec "$CONTAINER" psql -U regen -d regen -tA -c \
  "SELECT format('    (%L, %L, %L, %s)%s', slug, name, description, sort_order, CASE WHEN row_number() OVER (ORDER BY sort_order, slug) = count(*) OVER () THEN ';' ELSE ',' END) FROM community_categories ORDER BY sort_order, slug")"
if [ -z "$SEED_ROWS" ]; then
  echo "  !! alembic 결과 DB에서 community_categories 시드를 찾지 못했다." >&2
  exit 1
fi
SEED="-- 커뮤니티 카테고리 시드 (alembic 0005 _SEED_CATEGORIES 정본에서 추출)
-- id/created_at/is_active는 alembic과 동일하게 server_default를 사용한다.

INSERT INTO public.community_categories (slug, name, description, sort_order) VALUES
$SEED_ROWS"

echo "▶ V1__baseline.sql 재생성"
{
  cat <<'HEADER'
-- V1__baseline.sql — acting-api 스키마 동결본
--
-- alembic upgrade head 결과를
-- `pg_dump --schema-only --no-owner --no-privileges --exclude-table=alembic_version`
-- 으로 덤프해 만들었다. 손으로 고치지 않는다 — scripts/regen-baseline.sh 가 만든다.
--   1. psql 메타커맨드(\restrict/\unrestrict)와 SET/set_config 프리앰블 제거
--      (Flyway 는 psql 이 아니라 JDBC 로 실행한다)
--   2. op.bulk_insert 로 들어가던 시드를 파일 끝에 추가
--   3. 이 주석 블록
--
-- 이 파일이 스키마의 단일 소유자다. 빈 DB 는 이 파일로 재구축되고,
-- alembic 이 이미 만들어 둔 DB(dev·운영)에는 baseline 으로 기록만 된다.
--
-- 주의: --no-owner --no-privileges 라 owner/ACL 은 담기지 않는다. extension 과
-- sequence 의 last_value 도 마찬가지다. M6 의 재해복구 리허설에서 별도로 확인한다.

HEADER
  docker exec "$CONTAINER" pg_dump -U regen -d regen \
      --schema-only --no-owner --no-privileges --exclude-table=alembic_version \
    | grep -vE '^\\(restrict|unrestrict)' \
    | grep -vE "^SET " \
    | grep -vE "^SELECT pg_catalog\.set_config"
  echo
  echo "$SEED"
} > "$V1.tmp"
mv "$V1.tmp" "$V1"

echo "▶ fingerprint 재생성"
docker exec -i "$CONTAINER" psql -U regen -d regen -tA -q < "$FINGERPRINT_SQL" > "$FINGERPRINT.tmp"
mv "$FINGERPRINT.tmp" "$FINGERPRINT"

echo
echo "✔ 완료"
wc -l "$V1" "$FINGERPRINT"
echo
echo "다음: apps/api-java 에서 ./gradlew test 로 확인하고 두 파일을 함께 커밋하세요."
