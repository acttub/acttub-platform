#!/usr/bin/env bash
# Deploy workflow 의 입력 검증. GITHUB_OUTPUT 에서 홈서버 환경과 이미지 이름을 한 번만 정한다.
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
# 폐기한 AWS 복구/부분 배포 요청을 조용히 전체 홈서버 배포로 바꾸지 않는다.
[ -z "${INPUT_DESTINATION:-}" ] && [ -z "${INPUT_TARGET:-}" ] \
  || fail "destination/target 입력은 폐기됐다 — environment 만 지정해 홈서버 전체 스택을 배포한다"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail "GITHUB_SHA 는 40자 커밋 SHA 여야 한다"
base="ghcr.io/$(printf '%s' "$GITHUB_REPOSITORY" | tr '[:upper:]' '[:lower:]')"
{
  echo "api_image=$base/api:$GITHUB_SHA"
  echo "web_image=$base/web:$resolved-$GITHUB_SHA"
  echo "backup_image=$base/backup:$GITHUB_SHA"
} >> "$GITHUB_OUTPUT"
echo "배포 환경: $resolved / 경로: home / ref: $GITHUB_REF"
