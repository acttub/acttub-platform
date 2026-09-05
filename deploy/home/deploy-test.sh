#!/usr/bin/env bash
# deploy.sh 의 입력 및 실패 전파를 docker 명령 경계에서 검증한다. 실제 스택은 smoke.sh 가 검증한다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/bin"
cat > "$WORK/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = compose ] || exit 2
shift
while [ "${1:-}" = --env-file ]; do shift 2; done
case "${1:-}" in
  version) exit 0 ;;
  config)
    [ "${TEST_CONFIG_FAILURE:-false}" != true ] || exit 1
    printf 'api\nweb\ndb\n'
    [ "${TEST_BACKUP_ACTIVE:-false}" != true ] || echo backup ;;
  pull) echo "$*" >> "$TEST_CALLS"; [ "${TEST_PULL_FAILURE:-false}" != true ] ;;
  up) echo "$*" >> "$TEST_CALLS"; [ "${TEST_UP_FAILURE:-false}" != true ] ;;
  exec) printf '%s %s\n{}' "${TEST_STATUS:-200}" "${TEST_COMMIT:-0123456}" ;;
  ps|logs) : ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "$WORK/bin/docker"
printf 'services: {}\n' > "$WORK/compose.yml"
printf 'COMPOSE_PROFILES=edge\n' > "$WORK/.env"
run_deploy() {
  (cd "$WORK" && env PATH="$WORK/bin:$PATH" TEST_CALLS="$WORK/calls" \
    SHA=0123456789abcdef API_IMAGE=example/api:0123456 WEB_IMAGE=example/web:0123456 \
    BACKUP_IMAGE= DEPLOY_PULL_POLICY=missing DEPLOY_WAIT_SECONDS=180 "$@" \
    "$ROOT/deploy/home/deploy.sh") > "$WORK/log" 2>&1
}
success() { run_deploy "$@" || { cat "$WORK/log"; exit 1; }; }
failure() { if run_deploy "$@"; then echo "deploy.sh 가 잘못된 입력/실패를 허용했다: $*"; exit 1; fi; }
failure SHA=not-a-sha
failure API_IMAGE=$'example/api:tag\nADMIN_OPS_TOKEN=oops'
failure WEB_IMAGE='example/web:tag with spaces'
failure DEPLOY_WAIT_SECONDS=0
failure DEPLOY_WAIT_SECONDS=oops
failure DEPLOY_PULL_POLICY=never
printf 'previous-release\n' > "$WORK/release.env"
failure TEST_BACKUP_ACTIVE=true
grep -qx previous-release "$WORK/release.env"
failure TEST_CONFIG_FAILURE=true
grep -qx previous-release "$WORK/release.env"
success
grep -qx 'pull --policy missing api web' "$WORK/calls"
! grep -q '^BACKUP_IMAGE=' "$WORK/release.env"
: > "$WORK/calls"
success TEST_BACKUP_ACTIVE=true BACKUP_IMAGE=example/backup:0123456
grep -qx 'pull --policy missing api web backup' "$WORK/calls"
grep -qx 'BACKUP_IMAGE=example/backup:0123456' "$WORK/release.env"
failure TEST_PULL_FAILURE=true
failure TEST_UP_FAILURE=true
failure TEST_COMMIT=fffffff
failure TEST_STATUS=503
echo '✔ deploy.sh: 입력 거부·backup 프로필·compose 실패·health 불일치 검증 통과'
