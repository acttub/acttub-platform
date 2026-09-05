#!/usr/bin/env bash
# 실제 workflow guard 의 입력·종료 상태를 검증한다. 서버나 레지스트리에 접속하지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
run_guard() {
  env GITHUB_OUTPUT="$WORK/output" GITHUB_EVENT_NAME=workflow_dispatch \
    GITHUB_REF=refs/heads/main GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 \
    GITHUB_REPOSITORY=Acttub/Acttub-Platform INPUT_ENV=prod INPUT_DESTINATION=home \
    INPUT_TARGET=both INPUT_REBUILD=false GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 \
    "$@" "$ROOT/deploy/guard.sh" > "$WORK/log" 2>&1
}
check_success() {
  : > "$WORK/output"
  run_guard "$@" || { cat "$WORK/log"; exit 1; }
}
check_failure() {
  : > "$WORK/output"
  if run_guard "$@"; then echo "guard 가 잘못된 입력을 허용했다: $*"; exit 1; fi
}
check_success GITHUB_EVENT_NAME=push INPUT_ENV= INPUT_DESTINATION= INPUT_TARGET=
grep -qx 'environment=prod' "$WORK/output"
grep -qx 'destination=home' "$WORK/output"
grep -qx 'web_image=ghcr.io/acttub/acttub-platform/web:prod-0123456789abcdef0123456789abcdef01234567' "$WORK/output"
check_success GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/dev INPUT_ENV=
grep -qx 'environment=dev' "$WORK/output"
check_success INPUT_ENV=dev GITHUB_REF=refs/heads/feat/SOMA-489
check_success INPUT_DESTINATION=aws-rollback INPUT_TARGET=fe
check_failure GITHUB_REF=refs/heads/dev
check_failure GITHUB_REF=refs/tags/main
check_failure INPUT_ENV=staging
check_failure INPUT_DESTINATION=other
check_failure INPUT_DESTINATION=aws-rollback INPUT_ENV=dev GITHUB_REF=refs/heads/dev
check_failure INPUT_DESTINATION=aws-rollback GITHUB_EVENT_NAME=push
check_failure INPUT_TARGET=be-java-baseline
check_failure INPUT_TARGET=fe
check_failure INPUT_TARGET='both;touch /tmp/guard-bypass'
check_success INPUT_REBUILD=true
grep -qx 'web_image=ghcr.io/acttub/acttub-platform/web:prod-0123456789abcdef0123456789abcdef01234567' "$WORK/output"
echo '✔ workflow guard: main/ref·환경·대상·수동 AWS 복구 검증 통과'
