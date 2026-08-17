#!/usr/bin/env bash
# baseline-schema-fingerprint.txt 를 db/migration 전체를 적용한 결과로 다시 만든다.
#
#   apps/api-java/scripts/regen-fingerprint.sh
#
# 왜 필요한가: fixture 는 "Flyway 마이그레이션이 만드는 스키마" 의 기대값이고
# FlywayBaselineTest 가 그것과 대조한다. V2__ 를 더하면 fixture 가 낡는데, 갱신할 수단이
# 없으면 스키마를 아예 바꿀 수 없다. **스키마가 바뀌는 PR 마다 이것을 돌리고 결과를 커밋한다.**
#
# ⚠ V1__baseline.sql 은 동결이다 — 이 스크립트는 V1 을 만들지 않는다. 고치면 dev·운영은
#   멀쩡하고 신규 환경만 checksum mismatch 로 죽는다(spec/M6-findings.md 발견 1).
#   스키마 변경은 V2__ 부터 새 파일로 들어간다.
#
# 필요한 것: Docker 뿐이다. (alembic 이 정본이던 시절의 regen-baseline.sh 를 대체한다 —
# uv 도 파이썬도 필요 없다.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAVA_ROOT="$(cd "$HERE/.." && pwd)"

MIGRATIONS="$JAVA_ROOT/src/main/resources/db/migration"
FINGERPRINT="$JAVA_ROOT/src/test/resources/baseline-schema-fingerprint.txt"
FINGERPRINT_SQL="$JAVA_ROOT/src/test/resources/schema-fingerprint.sql"

CONTAINER="acttub-fingerprint-regen"
IMAGE="postgres:18-alpine"   # 운영 RDS 와 같은 메이저. 16 으로 뜨면 카탈로그 표현이 달라진다.

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▶ Postgres($IMAGE) 기동"
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=regen -e POSTGRES_USER=regen -e POSTGRES_DB=regen \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U regen >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U regen >/dev/null

# 버전 순으로 적용한다. `sort -V` 가 아니면 V10 이 V2 보다 앞에 온다.
# (mapfile 은 bash 4+ 라 macOS 기본 bash 3.2 에서 조용히 없다. 파일명 규약상 공백이 없어
#  단어 분할로 충분하다.)
FILES=$(find "$MIGRATIONS" -maxdepth 1 -name 'V*__*.sql' -exec basename {} \; | sort -V)
if [ -z "$FILES" ]; then
  echo "  !! $MIGRATIONS 에 마이그레이션이 없다." >&2
  exit 1
fi

for file in $FILES; do
  echo "▶ $file"
  # ON_ERROR_STOP 이 없으면 psql 이 실패한 문장을 건너뛰고 0 으로 끝나, 절반만 적용된
  # 스키마에서 fingerprint 를 떠 놓고 초록으로 보고하게 된다.
  docker exec -i "$CONTAINER" psql -U regen -d regen -v ON_ERROR_STOP=1 -q < "$MIGRATIONS/$file"
done

echo "▶ fingerprint 재생성"
docker exec -i "$CONTAINER" psql -U regen -d regen -tA -q < "$FINGERPRINT_SQL" > "$FINGERPRINT.tmp"
mv "$FINGERPRINT.tmp" "$FINGERPRINT"

echo
echo "✔ 완료"
wc -l "$FINGERPRINT"
echo
# 여기서는 psql 로 적용했지만 판정은 Flyway 가 적용한 결과와 비교한다. 둘이 어긋나면
# 아래 테스트가 잡는다 — 이 스크립트를 믿는 것이 아니라 그 테스트가 정본이다.
echo "다음: apps/api-java 에서 ./gradlew test --tests '*FlywayBaselineTest*' 로 확인하고 커밋하세요."
