#!/usr/bin/env bash
# ci.yml 의 경로 판정(SOMA-552). api·smoke 잡이 각각 부르고 결과를 $GITHUB_OUTPUT 에 쓴다.
#   api        — apps/api 의 Gradle 테스트
#   monitoring — 모니터링 설정·스모크
#   restore    — 복원 왕복·Restore·Backup
# dev 로 가는 PR 만 거른다. main 으로 가는 PR·매일 schedule·수동 실행은 전부 켠다.
# pull_request 의 체크아웃은 base 위의 merge commit 이라 HEAD^1 이 base 다(checkout fetch-depth: 2 필요).
set -euo pipefail

if [ "$EVENT" != pull_request ] || [ "$BASE_REF" = main ]; then
  echo "전체 실행 ($EVENT → ${BASE_REF:-없음})"
  printf 'api=true\nmonitoring=true\nrestore=true\n' >> "$GITHUB_OUTPUT"
  exit 0
fi

files="$(git diff --name-only HEAD^1 HEAD)"
printf '%s\n' "$files"
api=false; monitoring=false; restore=false
while IFS= read -r f; do
  case "$f" in
    .github/workflows/ci.yml|.github/scripts/ci-changes.sh) api=true; monitoring=true; restore=true ;;
    apps/api/*) api=true ;;
  esac
  case "$f" in
    deploy/monitoring/*|deploy/home/compose.yml|deploy/home/deploy.sh) monitoring=true ;;
  esac
  case "$f" in
    deploy/home/*|apps/api/src/main/resources/db/migration/*|apps/api/src/test/resources/schema-fingerprint.sql) restore=true ;;
  esac
done <<< "$files"
echo "api=$api monitoring=$monitoring restore=$restore"
printf 'api=%s\nmonitoring=%s\nrestore=%s\n' "$api" "$monitoring" "$restore" >> "$GITHUB_OUTPUT"
