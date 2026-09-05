#!/usr/bin/env bash
# Deploy workflow 의 입력 검증. GITHUB_OUTPUT 에서 이후 잡의 경로와 이미지 이름을 한 번만 정한다.
set -euo pipefail
fail() { echo "::error::$*" >&2; exit 1; }
resolved="${INPUT_ENV:-}"
if [ -z "$resolved" ]; then
  case "${GITHUB_REF:-}" in
    refs/heads/main) resolved=prod ;;
    refs/heads/dev) resolved=dev ;;
    *) fail "자동 배포 브랜치는 main 또는 dev 여야 한다" ;;
  esac
fi
case "$resolved" in dev|prod) ;; *) fail "배포 환경은 dev 또는 prod 여야 한다" ;; esac
# ref 가 잘못돼도 실패 알림에는 선택한 환경을 남긴다.
echo "environment=$resolved" >> "$GITHUB_OUTPUT"
if [ "$resolved" = prod ] && [ "${GITHUB_REF:-}" != refs/heads/main ]; then
  fail "운영 배포는 main 브랜치에서만 실행할 수 있다 — --ref main 으로 실행한다"
fi
destination="${INPUT_DESTINATION:-home}"
case "$destination" in home|aws-rollback) ;; *) fail "배포 경로는 home 또는 aws-rollback 이어야 한다" ;; esac
target="${INPUT_TARGET:-both}"
case "$target" in fe|be-java|both|be-java-baseline) ;; *) fail "알 수 없는 배포 대상이다" ;; esac
if [ "$destination" = aws-rollback ]; then
  [ "$resolved" = prod ] && [ "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ] \
    || fail "AWS 복구 배포는 main 의 수동 운영 배포에서만 실행할 수 있다"
else
  [ "$target" = both ] || fail "홈서버는 target=both 만 지원한다 — DB 는 Flyway 이력째 복원하며 baseline 하지 않는다"
fi
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail "GITHUB_SHA 는 40자 커밋 SHA 여야 한다"
base="ghcr.io/$(printf '%s' "$GITHUB_REPOSITORY" | tr '[:upper:]' '[:lower:]')"
{
  echo "destination=$destination"
  echo "api_image=$base/api:$GITHUB_SHA"
  echo "web_image=$base/web:$resolved-$GITHUB_SHA"
  echo "backup_image=$base/backup:$GITHUB_SHA"
} >> "$GITHUB_OUTPUT"
echo "배포 환경: $resolved / 경로: $destination / ref: $GITHUB_REF"
