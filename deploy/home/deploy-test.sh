#!/usr/bin/env bash
# deploy.sh 의 입력 및 실패 전파를 docker 명령 경계에서 검증한다. 실제 스택과 무중단 전환은 smoke.sh 가 검증한다.
# 가짜 docker 는 컨테이너를 상태 디렉토리의 파일 하나로 흉내 낸다(서비스·설정 해시·health·이름).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/bin"
cat > "$WORK/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
S="$TEST_STATE"
call() { echo "$*" >> "$TEST_CALLS"; }
field() { [ -f "$S/$1" ] && sed -n "${2}p" "$S/$1"; }   # 1 서비스 · 2 해시 · 3 health · 4 이름
ids_of() { local f; for f in "$S"/*; do [ -f "$f" ] && [ "$(sed -n 1p "$f")" = "$1" ] && echo "${f##*/}"; done; true; }
create() {  # <서비스> <해시> <health>
  local n=$(( $(cat "$S/.seq" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$S/.seq"
  printf '%s\n%s\n%s\n%s\n%s\n' "$1" "$2" "$3" "proj-$1-$n" "${TEST_IMAGE_ID:-image-v1}" > "$S/$1$n"
}
case "$1" in
  image)
    case "$2" in
      inspect) echo "${TEST_IMAGE_ID:-image-v1}" ;;
      ls) [ "${TEST_IMAGE_LS_FAILURE:-false}" != true ] && printf '%s\n' ${TEST_IMAGES:-} ;;
      rm) echo "image rm $3" >> "$TEST_CALLS"; [ "$3" != "${TEST_IMAGE_IN_USE:-}" ] ;;
      *) exit 2 ;;
    esac
    exit ;;
  inspect)
    case "$3" in
      *Health*) field "$4" 3 ;;
      *.Name*) echo "/$(field "$4" 4)" ;;
      *.Image*) field "$4" 5 ;;
      *config-hash*) field "$4" 2 ;;
      *) exit 2 ;;
    esac
    exit ;;
  rm) shift; [ "$1" != -f ] || shift; call "rm $*"; for id in "$@"; do rm -f "$S/$id"; done; exit ;;
  stop) call "stop $2"; exit ;;
  logs) exit ;;
  compose) shift ;;
  *) exit 2 ;;
esac
while [ "${1:-}" = --env-file ]; do shift 2; done
case "${1:-}" in
  version) exit 0 ;;
  config)
    [ "${TEST_CONFIG_FAILURE:-false}" != true ] || exit 1
    # --hash 는 proxy 의 라벨 비교에만, 서비스 하나의 config 출력은 api·web 의 지문(deploy.sh 가 cksum)에 쓰인다.
    if [ "${2:-}" = --hash ]; then echo "$3 ${TEST_PROXY_HASH:-p1}"; exit; fi
    if [ "${2:-}" != --no-env-resolution ]; then printf 'services:\n  %s:\n    test: %s\n' "$2" "${TEST_HASH:-h1}"; exit; fi
    printf 'api\nweb\ndb\nproxy\ncloudflared\n'
    [ "${TEST_BACKUP_ACTIVE:-false}" != true ] || echo backup ;;
  pull) call "$*"; [ "${TEST_PULL_FAILURE:-false}" != true ] ;;
  up)
    call "$*"
    svc="${!#}"
    case "$svc" in
      api|web)
        [ "${TEST_UP_FAILURE:-false}" != true ] || exit 1
        # Compose 2.38 처럼 env_file 이 있는 서비스는 라벨이 config --hash 와 다르게 남는다 — deploy.sh 가 라벨에 기대면 걸린다.
        create "$svc" "label-${TEST_HASH:-h1}" "${TEST_NEW_HEALTH:-healthy}" ;;
      proxy) rm -f "$S"/proxy*; create proxy "${TEST_PROXY_HASH:-p1}" healthy ;;
      cloudflared) [ "${TEST_TUNNEL_FAILURE:-false}" != true ] ;;
      # 넘긴 뒤의 backup 단계만 --remove-orphans 를 쓴다(3단계의 db 와 가른다).
      *) [[ " $* " != *" --remove-orphans "* ]] || [ "${TEST_PROFILE_FAILURE:-false}" != true ] ;;
    esac ;;
  ps)
    [ "${TEST_PS_FAILURE:-false}" != true ] || exit 1
    [ "${2:-}" = -a ] && shift
    if [ "${2:-}" = -q ]; then ids_of "$3"; fi ;;
  exec)
    call "$*"
    svc="$3"; shift 3
    if [ "$svc" = api ]; then
      if [ "${2:-}" = ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED ]; then
        printf '%s\n' "${TEST_GUEST_DAILY_LIMIT:-${DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED:-true}}"
      elif [ "${2:-}" = PRACTICE_REMINDER_ENABLED ]; then
        printf '%s\n' "${TEST_PRACTICE_REMINDER:-${DEPLOY_PRACTICE_REMINDER_ENABLED:-false}}"
      elif [ "${2:-}" = ACTTUB_DIRECT_VIDEO_ENABLED ]; then
        printf '%s\n' "${TEST_DIRECT_VIDEO:-${DEPLOY_DIRECT_VIDEO_ENABLED:-false}}"
      else
        printf '%s\n' "${TEST_THREE_LAYERS:-${DEPLOY_THREE_LAYERS_ENABLED:-false}}"
      fi
    else
      case "$1" in
        pgrep) echo 11 ;;
        nginx) [ "${TEST_NGINX_FAILURE:-false}" != true ] ;;
        wget) [ "${TEST_STATUS:-200}" = 200 ] && printf '{"status":"ok","commit":"%s"}' "${TEST_COMMIT:-0123456}" ;;
        sh)
          if [[ "${3:-}" == *"kill -0"* ]]; then
            # 드레인 확인 — TEST_WORKERS_ALIVE 번까지는 옛 worker 가 아직 살아 있다고 답한다(처리 중인 요청이 있다).
            [ "${TEST_DRAIN_FAILURE:-false}" != true ] || exit 1
            n=$(( $(cat "$S/.sh" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/.sh"
            if [ "$n" -le "${TEST_WORKERS_ALIVE:-0}" ]; then echo busy; else echo done; fi
          fi ;;  # reload 확인 — 새 worker 만 손님을 받는다
        *) exit 2 ;;
      esac
    fi ;;
  logs) : ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "$WORK/bin/docker"
mkdir "$WORK/state" "$WORK/proxy"
printf 'services: {}\n' > "$WORK/compose.yml"
printf '# test\n' > "$WORK/proxy/nginx.conf"
printf 'COMPOSE_PROFILES=edge\n' > "$WORK/.env"
run_deploy() {
  (cd "$WORK" && env PATH="$WORK/bin:$PATH" TEST_CALLS="$WORK/calls" TEST_STATE="$WORK/state" \
    SHA=0123456789abcdef API_IMAGE=example/api:0123456 WEB_IMAGE=example/web:0123456 \
    BACKUP_IMAGE= DEPLOY_PULL_POLICY=missing DEPLOY_WAIT_SECONDS=180 DEPLOY_THREE_LAYERS_ENABLED= DEPLOY_DIRECT_VIDEO_ENABLED= DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED= DEPLOY_PRACTICE_REMINDER_ENABLED= DEPLOY_CPU_SHARES= "$@" \
    "$ROOT/deploy/home/deploy.sh") > "$WORK/log" 2>&1
}
success() { run_deploy "$@" || { cat "$WORK/log"; exit 1; }; }
failure() { if run_deploy "$@"; then cat "$WORK/log"; echo "deploy.sh 가 잘못된 입력/실패를 허용했다: $*"; exit 1; fi; }
# containers <서비스> → 그 서비스의 가짜 컨테이너 ID 목록(한 줄)
containers() { (cd "$WORK/state" && for f in *; do [ -f "$f" ] && [ "$(sed -n 1p "$f")" = "$1" ] && printf '%s ' "$f"; done; true); }
active() { sed -n "s/^map [$]host [$]$1_upstream { default \([^: ;]*\):.*/\1/p" "$WORK/proxy/active.conf"; }

failure SHA=not-a-sha
failure API_IMAGE=$'example/api:tag\nADMIN_OPS_TOKEN=oops'
failure WEB_IMAGE='example/web:tag with spaces'
failure DEPLOY_WAIT_SECONDS=0
failure DEPLOY_WAIT_SECONDS=oops
failure DEPLOY_PULL_POLICY=never
failure DEPLOY_THREE_LAYERS_ENABLED=invalid
failure DEPLOY_DIRECT_VIDEO_ENABLED=invalid
failure DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=invalid
failure DEPLOY_PRACTICE_REMINDER_ENABLED=invalid
failure DEPLOY_CPU_SHARES=oops
failure DEPLOY_CPU_SHARES=0
printf 'previous-release\n' > "$WORK/release.env"
failure TEST_BACKUP_ACTIVE=true
grep -qx previous-release "$WORK/release.env"
failure TEST_CONFIG_FAILURE=true
grep -qx previous-release "$WORK/release.env"
# 컨테이너를 만들기 전의 실패도 release.env 를 직전 것으로 되돌린다.
failure TEST_PULL_FAILURE=true
grep -qx previous-release "$WORK/release.env"
failure TEST_UP_FAILURE=true
grep -qx previous-release "$WORK/release.env"
[ -z "$(containers api)" ] || exit 1
# 첫 배포: 옛 판이 없으니 바로 만들고, proxy 를 새로 띄운다(reload 할 것이 없다).
: > "$WORK/calls"
success
grep -qx 'pull --policy missing api web' "$WORK/calls"
! grep -q '^BACKUP_IMAGE=' "$WORK/release.env" || exit 1
[ ! -e "$WORK/release.env.prev" ] || exit 1
[ "$(active api)" = proj-api-1 ]
[ "$(active web)" = proj-web-2 ]
grep -q '^# config-hash api [0-9]*-[0-9]*$' "$WORK/proxy/active.conf"
grep -q '^up -d --no-deps --wait --wait-timeout 180 proxy$' "$WORK/calls"
! grep -q 'reload' "$WORK/calls" || exit 1
# 같은 설정으로 다시: 새 컨테이너 없이 reload 만 하고 아무것도 내리지 않는다(멱등).
: > "$WORK/calls"
success
[ "$(containers api)" = "api1 " ]
[ "$(containers web)" = "web2 " ]
! grep -q -- '--scale' "$WORK/calls" || exit 1
! grep -q '^stop ' "$WORK/calls" || exit 1
grep -q 'nginx -c /etc/nginx/acttub/nginx.conf -s reload' "$WORK/calls"
# 설정이 바뀌면 옆에 띄우고 → 넘기고 → 옛 worker 가 처리 중인 요청을 끝낸 뒤 → 옛 것을 내린다.
: > "$WORK/calls"
rm -f "$WORK/state/.sh"
success TEST_HASH=h2 TEST_WORKERS_ALIVE=2
grep -qx 'up -d --no-deps --no-recreate --scale api=2 api' "$WORK/calls"
grep -qx 'up -d --no-deps --no-recreate --scale web=2 web' "$WORK/calls"
[ "$(active api)" = proj-api-4 ]
[ "$(active web)" = proj-web-5 ]
grep -qx 'stop api1' "$WORK/calls"
grep -qx 'stop web2' "$WORK/calls"
# 터널은 옛 web 을 내리기 전에 맞춘다 — 망을 옮기는 배포에서 옛 cloudflared 는 옛 web 으로 직접 간다.
tunnel_at="$(grep -n -x 'up -d --no-deps --wait --wait-timeout 180 cloudflared' "$WORK/calls" | cut -d: -f1)"
stop_at="$(grep -n -x 'stop web2' "$WORK/calls" | cut -d: -f1)"
[ "$tunnel_at" -lt "$stop_at" ]
# 옛 worker 가 살아 있다고 답한 동안은 옛 컨테이너를 멈추지 않는다(드레인). 세 번째 물음에서야 끝났다고 답한다.
[ "$(grep -c '^exec -T proxy sh -c for p in' "$WORK/calls")" = 3 ]
drained_at="$(grep -n '^exec -T proxy sh -c for p in' "$WORK/calls" | tail -1 | cut -d: -f1)"
[ "$drained_at" -lt "$(grep -n -x 'stop api1' "$WORK/calls" | cut -d: -f1)" ]
# reload 뒤 손님을 받는 worker 가 모두 새 것임을 확인한 다음에 commit 을 대조한다.
reloaded_at="$(grep -n '^exec -T proxy sh -c old=' "$WORK/calls" | head -1 | cut -d: -f1)"
[ "$reloaded_at" -lt "$(grep -n '^exec -T proxy wget' "$WORK/calls" | head -1 | cut -d: -f1)" ]
# 넘긴 뒤 commit 이 다르면 proxy 를 옛 컨테이너로 되돌리고 새 것을 지우고 release.env 를 되돌린다.
cp "$WORK/release.env" "$WORK/committed-release.env"
: > "$WORK/calls"
rm -f "$WORK/state/.sh"
failure TEST_HASH=h3 TEST_COMMIT=fffffff TEST_IMAGES=example/api:aaaaaaa TEST_WORKERS_ALIVE=2
grep -q '✗.*commit.*다르다' "$WORK/log"
[ "$(active api)" = proj-api-4 ]
[ "$(active web)" = proj-web-5 ]
[ "$(containers api)" = "api4 " ]
[ "$(containers web)" = "web5 " ]
cmp "$WORK/committed-release.env" "$WORK/release.env"
! grep -q '^image rm' "$WORK/calls" || exit 1
! grep -q '^stop ' "$WORK/calls" || exit 1
# 역방향 reload도 새 요청의 전환과 진행 중 요청의 종료를 확인한 뒤 새 컨테이너를 지운다.
[ "$(grep -c '^exec -T proxy sh -c for p in' "$WORK/calls")" = 3 ]
undo_drain_at="$(grep -n '^exec -T proxy sh -c for p in' "$WORK/calls" | tail -1 | cut -d: -f1)"
[ "$undo_drain_at" -lt "$(grep -n '^rm api6$' "$WORK/calls" | cut -d: -f1)" ]
failure TEST_HASH=h3 TEST_STATUS=503
[ "$(containers api)" = "api4 " ] || exit 1
# 새 컨테이너가 healthy 가 못 되면 넘기지 않는다 — proxy 를 건드리지 않고 옛 판이 그대로다.
for state in starting unhealthy; do
  : > "$WORK/calls"
  failure TEST_HASH=h3 TEST_NEW_HEALTH="$state" DEPLOY_WAIT_SECONDS=1
  grep -q 'healthy 가 되지 않았다' "$WORK/log"
  ! grep -q '^exec ' "$WORK/calls" || exit 1
  [ "$(containers api)" = "api4 " ]
  [ "$(active api)" = proj-api-4 ]
  cmp "$WORK/committed-release.env" "$WORK/release.env"
done
failure TEST_HASH=h3 TEST_NGINX_FAILURE=true
# 역방향 reload까지 실패하면 응답 중일 수 있는 새 판도 남겨 수동 복구할 수 있게 한다.
[ -f "$WORK/state/web5" ] && [ -f "$WORK/state/web15" ]
[ "$(containers web | wc -w | tr -d ' ')" = 2 ]
# 설정 검사에서 멈춰도 active.conf 는 옛 컨테이너를 가리켜야 한다 — 낡은 이름이 남으면 다음 배포가 응답 중인 판을 지운다.
[ "$(active api)" = proj-api-4 ]
[ "$(active web)" = proj-web-5 ]
failure TEST_PS_FAILURE=true
# 넘긴 뒤의 실패는 새 판을 되돌리지 않는다. 터널이 실패하면 옛 컨테이너가 남고, 다음 배포가 그것을 지운다.
failure TEST_HASH=h4 TEST_TUNNEL_FAILURE=true
grep -q '이미 새 판이다' "$WORK/log"
[ "$(active api)" = proj-api-16 ]
[ "$(containers api | wc -w | tr -d ' ')" = 2 ]
: > "$WORK/calls"
success TEST_HASH=h4 TEST_BACKUP_ACTIVE=true BACKUP_IMAGE=example/backup:0123456
grep -qx 'pull --policy missing api web backup' "$WORK/calls"
grep -qx 'BACKUP_IMAGE=example/backup:0123456' "$WORK/release.env"
grep -qx 'up -d --no-deps --wait --wait-timeout 180 cloudflared' "$WORK/calls"
grep -qx 'up -d --no-deps --remove-orphans --wait --wait-timeout 180 db backup' "$WORK/calls"
grep -qx 'rm api4' "$WORK/calls"
[ "$(containers api)" = "api16 " ]
[ "$(containers web)" = "web17 " ]
# active.conf 가 없는 컨테이너를 가리켜도(손으로 고침·중단) 응답 중인 healthy 컨테이너를 지우지 않고 옆에 띄운다.
printf 'map $host $api_upstream { default proj-api-999:8080; }\nmap $host $web_upstream { default proj-web-999:3000; }\n' > "$WORK/proxy/active.conf"
: > "$WORK/calls"
success TEST_HASH=h4b
grep -qx 'up -d --no-deps --no-recreate --scale api=2 api' "$WORK/calls"
grep -qx 'stop api16' "$WORK/calls"
[ "$(containers api | wc -w | tr -d ' ')" = 1 ]
# backup 이 실패해도 새 판은 그대로이고, 옛 판은 그 전에 이미 내려갔다.
failure TEST_HASH=h5 TEST_PROFILE_FAILURE=true
grep -q '이미 새 판이다' "$WORK/log"
[ "$(containers api)" = "api20 " ]
[ "$(active api)" = proj-api-20 ]
success TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=true
grep -qx 'ACTTUB_THREE_LAYERS_ENABLED=true' "$WORK/release.env"
cp "$WORK/release.env" "$WORK/enabled-release.env"
success TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=true
cmp "$WORK/enabled-release.env" "$WORK/release.env"
failure TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=true TEST_THREE_LAYERS=false
success TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=false
grep -qx 'ACTTUB_THREE_LAYERS_ENABLED=false' "$WORK/release.env"
success TEST_HASH=h4
! grep -q '^ACTTUB_THREE_LAYERS_ENABLED=' "$WORK/release.env" || exit 1
! grep -q '_CPU_SHARES=' "$WORK/release.env" || exit 1
success TEST_HASH=h4 DEPLOY_CPU_SHARES=256
grep -qx 'API_CPU_SHARES=256' "$WORK/release.env"
grep -qx 'WEB_CPU_SHARES=256' "$WORK/release.env"
grep -qx 'PRON_CPU_SHARES=256' "$WORK/release.env"
success TEST_HASH=h4 DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=false
grep -qx 'ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=false' "$WORK/release.env"
failure TEST_HASH=h4 DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=false TEST_GUEST_DAILY_LIMIT=true
success TEST_HASH=h4 DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=true
grep -qx 'ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=true' "$WORK/release.env"
success TEST_HASH=h4
! grep -q '^ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=' "$WORK/release.env" || exit 1
# ls 가 다른 저장소를 섞어 돌려줘도 이번 이미지의 저장소에 있는 릴리스 태그만 지우고, 쓰는 중인 이미지의 거부는 무시한다.
: > "$WORK/calls"
success TEST_HASH=h4 TEST_IMAGES='example/api:0123456 example/api:aaaaaaa example/api:soma489-smoke-1 example/web:0123456 example/web:dev-bbbbbbb other/api:ccccccc example/api:ddddddd' \
  TEST_IMAGE_IN_USE=example/api:ddddddd
[ "$(grep '^image rm' "$WORK/calls")" = "$(printf 'image rm %s\n' example/api:aaaaaaa example/api:ddddddd example/web:dev-bbbbbbb)" ]
grep -qx '  지움 example/api:aaaaaaa' "$WORK/log"
! grep -q 'ddddddd' "$WORK/log" || exit 1
success TEST_HASH=h4 TEST_IMAGE_LS_FAILURE=true
success TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=true DEPLOY_DIRECT_VIDEO_ENABLED=true
grep -qx 'ACTTUB_DIRECT_VIDEO_ENABLED=true' "$WORK/release.env"
cp "$WORK/release.env" "$WORK/direct-release.env"
success TEST_HASH=h4 DEPLOY_THREE_LAYERS_ENABLED=true DEPLOY_DIRECT_VIDEO_ENABLED=true
cmp "$WORK/direct-release.env" "$WORK/release.env"
failure TEST_HASH=h4 DEPLOY_DIRECT_VIDEO_ENABLED=true TEST_DIRECT_VIDEO=false
success TEST_HASH=h4 DEPLOY_DIRECT_VIDEO_ENABLED=false
grep -qx 'ACTTUB_DIRECT_VIDEO_ENABLED=false' "$WORK/release.env"
success TEST_HASH=h4
! grep -q '^ACTTUB_DIRECT_VIDEO_ENABLED=' "$WORK/release.env" || exit 1
# 설정·태그가 같아도 이미지 ID가 달라지면 API·웹을 교체하고, 다시 실행하면 그대로 유지한다.
before_api="$(containers api)" before_web="$(containers web)"
success TEST_HASH=h4 TEST_IMAGE_ID=image-v2
[ "$(containers api)" != "$before_api" ] && [ "$(containers web)" != "$before_web" ]
before_api="$(containers api)" before_web="$(containers web)"
success TEST_HASH=h4 TEST_IMAGE_ID=image-v2
[ "$(containers api)" = "$before_api" ] && [ "$(containers web)" = "$before_web" ]
# drain 상태를 읽지 못한 롤백은 새 판을 삭제하거나 릴리스 설정을 덮어 되돌리지 않는다.
failure TEST_HASH=h5 TEST_IMAGE_ID=image-v2 TEST_COMMIT=fffffff TEST_DRAIN_FAILURE=true
grep -q '새 컨테이너를 남긴다' "$WORK/log"
[ "$(containers api | wc -w | tr -d ' ')" = 2 ]
[ "$(containers web | wc -w | tr -d ' ')" = 2 ]
[ -f "$WORK/release.env.prev" ]
echo '✔ deploy.sh: 입력 거부·backup 프로필·첫 배포·멱등·옆에 띄워 넘기기·넘기기 전후 실패의 되돌리기·스위치 대조·옛 이미지 정리 검증 통과'
