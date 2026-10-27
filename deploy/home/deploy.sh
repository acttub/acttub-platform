#!/usr/bin/env bash
# 홈서버 배포 스크립트(SOMA-489, 무중단 SOMA-700). 서버의 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다 —
# 거기에 compose.yml·proxy/nginx.conf 와 사람이 채운 .env 가 있고, 이 스크립트가 release.env·proxy/active.conf 를 쓴다.
#
#   cd /svc/acttub/dev
#   ./deploy.sh <sha> <api 이미지> <web 이미지> [backup 이미지]
#   예) ./deploy.sh 3f2a9c1e… ghcr.io/acttub/acttub-platform/api:3f2a9c1e… ghcr.io/acttub/acttub-platform/web:dev-3f2a9c1e…
#   값은 환경변수 SHA·API_IMAGE·WEB_IMAGE·BACKUP_IMAGE 로 줘도 된다(인자가 우선) — 워크플로가 ssh 로 넘길 때 어느 쪽이든 되게.
#   sha 는 7~40자 16진수.
#
# 하는 일 — 어느 단계든 실패하면 exit≠0 이다. 새 판으로 넘어간 것을 확인하기 전의 실패는 새 컨테이너를 지우고
# release.env 를 되돌린다 — 옛 판이 계속 응답한다. 롤백의 전환·요청 마무리를 확인하지 못하면 새 판도 남긴다.
#   1. 입력과 compose 를 점검한 뒤 release.env 를 새로 쓴다: API_IMAGE·WEB_IMAGE·BACKUP_IMAGE(선택)·RENDER_GIT_COMMIT·SENTRY_RELEASE.
#      사람이 관리하는 .env 는 읽기만 한다. 어느 프로필을 띄울지(cloudflared=edge·backup)도 .env 의
#      COMPOSE_PROFILES 가 정하고 이 스크립트는 그대로 따른다.
#   2. docker compose pull        DEPLOY_PULL_POLICY=always(기본)|missing — 로컬 태그로 스모크할 때 missing
#   3. db 를 띄운다. api·web 은 맨손 compose up 으로 건드리지 않는다 — Compose 는 옛 컨테이너를 먼저 내리고 새 것을 띄운다.
#   4. 설정이나 이미지 ID가 바뀐 api·web 만 새 컨테이너를 옛 것 옆에 띄우고(--scale 2 --no-recreate) healthy 를 기다린다.
#      DEPLOY_WAIT_SECONDS(기본 180) 안에 healthy 가 아니면 실패. 크래시루프는 여기서 시간 초과로 걸린다.
#   5. proxy/active.conf 를 새 컨테이너로 쓰고 proxy(nginx)를 reload 한다 — web·api 가 한 번에 넘어간다.
#   6. proxy 안에서 GET /health(proxy → web → proxy → api 전체 길)의 commit 이 sha 앞 7자와 같은지 본다. 다르면 proxy 를
#      옛 컨테이너로 되돌리고 실패.
#   7. 터널(cloudflared, edge 프로필)을 맞춘다. 평소에는 바뀔 것이 없다.
#   8. 옛 nginx worker 가 처리 중이던 요청을 다 끝내면(최대 DRAIN_SECONDS) 옛 api·web 을 멈추고 지운다.
#   9. backup 프로필을 맞추고 compose 에서 빠진 서비스의 컨테이너를 지운다(--remove-orphans).
#  10. 기능 스위치가 api 컨테이너에 실제로 들어갔는지 대조한다.
#  11. 컨테이너가 쓰지 않는 옛 릴리스 이미지를 지운다. 이 단계의 실패는 배포를 실패시키지 않는다.
#
# 같은 sha·설정·이미지로 다시 돌리면 아무것도 다시 만들지 않는다(멱등). .env 만 고쳤을 때도 같은 sha 로
# 다시 돌리면 바뀐 서비스만 같은 길로 갈아 끼운다 — 맨손 compose up 으로 적용하면 그 서비스는 끊긴다.
# 롤백은 이전 sha·이미지로 같은 명령을 다시 부르는 것이다. 11단계가 지운 이미지는 2단계가 GHCR 에서 다시 받는다.
#
# compose 는 반드시 --env-file .env --env-file release.env 로 부른다 — 파일 안 ${API_IMAGE} 치환은
# --env-file 로 읽은 값만 보고, env_file: 은 컨테이너 환경만 넣는다(compose.yml 머리 주석). 맨손
# `docker compose up` 은 그래서 API_IMAGE 없음으로 거부된다.
set -euo pipefail

SHA="${1:-${SHA:-}}"
API_IMAGE="${2:-${API_IMAGE:-}}"
WEB_IMAGE="${3:-${WEB_IMAGE:-}}"
BACKUP_IMAGE="${4:-${BACKUP_IMAGE:-}}"
PULL_POLICY="${DEPLOY_PULL_POLICY:-always}"
WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-180}"
THREE_LAYERS_ENABLED="${DEPLOY_THREE_LAYERS_ENABLED:-}"
DIRECT_VIDEO_ENABLED="${DEPLOY_DIRECT_VIDEO_ENABLED:-}"
GUEST_DAILY_LIMIT_ENABLED="${DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED:-}"
PRACTICE_REMINDER_ENABLED="${DEPLOY_PRACTICE_REMINDER_ENABLED:-}"
# CPU 가 모자랄 때의 몫(compose 의 *_CPU_SHARES). dev 는 낮춰 운영 코칭이 먼저 쓰게 한다. 비우면 compose 기본(1024).
CPU_SHARES="${DEPLOY_CPU_SHARES:-}"
# 옛 nginx worker 를 기다리는 상한. proxy/nginx.conf 의 worker_shutdown_timeout(120s)에 여유를 더한다.
DRAIN_SECONDS=130
ACTIVE=proxy/active.conf

step() { printf '▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$#" -le 4 ] || fail "인자는 sha·api·web·backup(선택) 넷까지 받는다"
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || fail "sha 가 7~40자 16진수가 아니다: '$SHA' (사용법: deploy.sh <sha> <api 이미지> <web 이미지>)"
[ -n "$API_IMAGE" ] || fail "API 이미지가 없다 — 2번째 인자 또는 API_IMAGE"
[ -n "$WEB_IMAGE" ] || fail "web 이미지가 없다 — 3번째 인자 또는 WEB_IMAGE"
# 이미지 이름은 release.env 값으로 쓴다. 공백·개행·쉘 치환을 거부해 다른 설정이 주입되지 않게 한다.
for image in "$API_IMAGE" "$WEB_IMAGE" "${BACKUP_IMAGE:-unused}"; do
  [[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$ ]] || fail "이미지 이름에 허용하지 않는 문자가 있다"
done
case "$PULL_POLICY" in always|missing) ;; *) fail "DEPLOY_PULL_POLICY 는 always 또는 missing: '$PULL_POLICY'" ;; esac
case "$GUEST_DAILY_LIMIT_ENABLED" in ''|true|false) ;; *) fail "DEPLOY_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED 는 true 또는 false" ;; esac
case "$THREE_LAYERS_ENABLED" in ''|true|false) ;; *) fail "DEPLOY_THREE_LAYERS_ENABLED 는 true 또는 false" ;; esac
case "$DIRECT_VIDEO_ENABLED" in ''|true|false) ;; *) fail "DEPLOY_DIRECT_VIDEO_ENABLED 는 true 또는 false" ;; esac
case "$PRACTICE_REMINDER_ENABLED" in ''|true|false) ;; *) fail "DEPLOY_PRACTICE_REMINDER_ENABLED 는 true 또는 false" ;; esac
[ -z "$CPU_SHARES" ] || [[ "$CPU_SHARES" =~ ^[1-9][0-9]{0,5}$ ]] || fail "DEPLOY_CPU_SHARES 는 양의 정수: '$CPU_SHARES'"
[[ "$WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "DEPLOY_WAIT_SECONDS 는 양의 초 단위 정수: '$WAIT_SECONDS'"
[ -f compose.yml ] || fail "compose.yml 이 없다 — 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다: $PWD"
[ -f proxy/nginx.conf ] || fail "proxy/nginx.conf 가 없다 — 워크플로가 compose.yml 과 함께 보낸다: $PWD"
[ -f .env ] || fail ".env 가 없다 — 사람이 채우는 파일이다(deploy/home/.env.example): $PWD"
command -v docker >/dev/null || fail "docker 가 없다"
docker compose version >/dev/null 2>&1 || fail "docker compose 가 없다"

RELEASE_FILE=release.env
compose() { docker compose --env-file .env --env-file "$RELEASE_FILE" "$@"; }

# 컨테이너 하나의 health(healthcheck 가 없으면 상태)·이름·설정 해시.
state_of() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1"; }
name_of() { local n; n="$(docker inspect -f '{{.Name}}' "$1")" && printf '%s\n' "${n#/}"; }
hash_of() { docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$1"; }
# compose 가 지금 설정으로 만들 컨테이너의 해시 — 도는 컨테이너의 라벨과 같으면 바뀐 것이 없다. proxy 에만 쓴다(아래).
want_hash() { local out; out="$(compose config --hash "$1")" && printf '%s\n' "${out##* }"; }
# api·web 의 지문 — 서비스 하나의 config 출력(env_file 에서 읽은 environment 포함)의 cksum. config --hash 를 쓰지 않는다:
# Compose 2.38 의 config --hash 는 env_file 의 내용이 바뀌어도 그대로라 .env·release.env 만 바뀐 배포를 놓쳤다(SOMA-700 시험).
fingerprint() { local out; out="$(compose config "$1" | cksum)" && set -- $out && printf '%s-%s\n' "$1" "$2"; }
# proxy 가 지금 넘겨주는 컨테이너 이름(web|api)과 그 컨테이너를 만든 설정의 지문. active.conf 가 없으면 빈 값.
active_name() { [ ! -f "$ACTIVE" ] || sed -n "s/^map [$]host [$]$1_upstream { default \([^: ;]*\):.*/\1/p" "$ACTIVE"; }
active_hash() { [ ! -f "$ACTIVE" ] || sed -n "s/^# config-hash $1 \([^ ]*\)$/\1/p" "$ACTIVE"; }
nginx_cmd() { compose exec -T proxy nginx -c /etc/nginx/acttub/nginx.conf "$@"; }
# 옛 worker(인자로 받은 PID) 가 하나도 손님을 받지 않고 새 worker 가 하나 이상 받으면 0. busybox 의 pgrep -x 는 nginx 를 못
# 찾아서 comm 으로 찾고 /proc/<pid>/cmdline 의 제목으로 가른다(정리 중인 worker 는 "… is shutting down").
RELOADED_CHECK='old=" $* "; ready=0; for p in $(pgrep nginx); do t=$(tr "\0" " " < "/proc/$p/cmdline" 2>/dev/null); case "$t" in "nginx: worker process is shutting down"*) ;; "nginx: worker process"*) case "$old" in *" $p "*) exit 1 ;; esac; ready=1 ;; esac; done; [ "$ready" = 1 ]'
wait_reloaded() {
  local i
  for i in $(seq 1 50); do
    # shellcheck disable=SC2086 # old_workers 는 공백으로 가른 PID 목록이다.
    compose exec -T proxy sh -c "$RELOADED_CHECK" -- $old_workers && return 0
    sleep 0.2
  done
  return 1
}

drain_workers() {
  [ -n "$old_workers" ] || return 0
  local deadline=$((SECONDS + DRAIN_SECONDS)) workers
  step "nginx worker 가 처리 중인 요청을 끝내기를 기다린다 (최대 ${DRAIN_SECONDS}초)"
  while :; do
    workers="$(compose exec -T proxy sh -c "for p in $old_workers; do if kill -0 \$p 2>/dev/null; then echo busy; exit 0; fi; done; echo done")" || return 1
    case "$workers" in done) return 0 ;; busy) ;; *) return 1 ;; esac
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 1
  done
}

# write_active <web 이름> <api 이름> <web 해시> <api 해시> — 임시 파일에 쓰고 mv 로 바꾼다(reload 가 반쯤 쓴 파일을 읽지 않게).
# 지문은 다음 배포가 "바뀐 것이 없다"를 가르는 기준이다(roll). 주석이라 nginx 는 읽지 않는다.
write_active() {
  local tmp
  tmp="$(mktemp proxy/active.conf.XXXXXX)" || return 1
  printf '%s\n' \
    "# deploy.sh 가 배포마다 쓴다 — 손으로 고치지 않는다. proxy 가 넘겨줄 지금 판의 컨테이너(nginx.conf 가 include)." \
    "# config-hash web $3" \
    "# config-hash api $4" \
    "map \$host \$web_upstream { default $1:3000; }" \
    "map \$host \$api_upstream { default $2:8080; }" > "$tmp" \
    && chmod 644 "$tmp" && mv -f "$tmp" "$ACTIVE"
}

# 실패하면 EXIT 에서 phase 에 맞게 되돌린다. rolling·switched 는 안전하게 복구된 뒤 새 컨테이너를 지우고 release.env 를 되돌린다.
# committed 뒤의 실패(터널·옛 컨테이너 정리·backup)는 새 판이 이미 응답하므로 되돌리지 않는다.
phase=prepare
release_tmp=""
created=""
old_api="" new_api="" old_web="" new_web=""
old_api_hash="" new_api_hash="" old_web_hash="" new_web_hash=""
undo() {
  local id old_workers=""
  printf '▶ 되돌리기 — 새 컨테이너를 지우고 옛 판을 그대로 둔다\n' >&2
  if [ "$phase" = switched ] && [ -n "$old_web" ] && [ -n "$old_api" ]; then
    # 역방향 전환도 새 판에 이미 들어간 요청을 끝낸 뒤에만 그 컨테이너를 지운다.
    if old_workers="$(compose exec -T proxy pgrep -f 'nginx: worker process' | tr '\n' ' ')" \
      && write_active "$(name_of "$old_web")" "$(name_of "$old_api")" "$old_web_hash" "$old_api_hash" \
      && nginx_cmd -t -q && nginx_cmd -s reload && wait_reloaded && drain_workers; then
      echo "  proxy 를 옛 컨테이너로 되돌렸다" >&2
    else
      echo "⚠ proxy 복구·요청 마무리를 확인하지 못해 새 컨테이너를 남긴다 — proxy/active.conf 와 compose ps 를 본다" >&2
      compose ps >&2
      return 1
    fi
  fi
  for id in $created; do
    echo "── $(name_of "$id") 로그 끝 ──" >&2
    docker logs --tail 60 "$id" 2>&1 | sed 's/^/  /' >&2
    docker rm -f "$id" >/dev/null
  done
  [ ! -f release.env.prev ] || mv -f release.env.prev release.env
  compose ps >&2
}
on_exit() {
  local status=$?
  set +e
  [ -z "$release_tmp" ] || rm -f "$release_tmp"
  if [ "$status" -ne 0 ] && { [ "$phase" = rolling ] || [ "$phase" = switched ]; }; then undo; fi
  exit "$status"
}
trap on_exit EXIT

# 프로필은 .env 의 COMPOSE_PROFILES 가 정한다. 그 줄이 없으면 compose 는 말없이 web·api·db·proxy 만 띄우므로(터널 없음)
# 여기서 한 줄 경고한다 — 스모크의 테스트용 .env 는 일부러 그 줄이 없어 이 경고가 나온다.
grep -q '^COMPOSE_PROFILES=.' .env \
  || echo "⚠ .env 에 COMPOSE_PROFILES 가 없다 — cloudflared(edge)·backup 없이 web·api·db·proxy 만 뜬다" >&2

# ── 1. release.env ─────────────────────────────────────────────────────────────
# 임시 파일에 쓰고 mv 로 바꾼다 — 도중에 죽어도 반쯤 쓰인 release.env 가 남지 않는다.
# RENDER_GIT_COMMIT 은 /health 의 commit(HealthController, 앞 7자), SENTRY_RELEASE 는 Sentry 릴리스 태그.
# 이름이 RENDER_* 인 것은 기존 앱 설정과의 호환성을 유지하기 위해서다.
step "release.env 쓰기 — commit ${SHA:0:7}, api $API_IMAGE, web $WEB_IMAGE"
release_tmp="$(mktemp ./release.env.XXXXXX)"
RELEASE_FILE="$release_tmp"
cat > "$RELEASE_FILE" <<EOF
# deploy.sh 가 배포마다 새로 쓴다 — 손으로 고치지 않는다. 컨테이너 환경(env_file)과 compose 치환(--env-file) 둘 다 읽는다.
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
RENDER_GIT_COMMIT=$SHA
SENTRY_RELEASE=$SHA
EOF
[ -z "$BACKUP_IMAGE" ] || printf 'BACKUP_IMAGE=%s\n' "$BACKUP_IMAGE" >> "$RELEASE_FILE"
# 명시한 환경만 새 연습 경로를 전환한다. .env 는 유지하고 릴리스 설정에 기록한다.
[ -z "$THREE_LAYERS_ENABLED" ] || printf 'ACTTUB_THREE_LAYERS_ENABLED=%s\n' "$THREE_LAYERS_ENABLED" >> "$RELEASE_FILE"
[ -z "$DIRECT_VIDEO_ENABLED" ] || printf 'ACTTUB_DIRECT_VIDEO_ENABLED=%s\n' "$DIRECT_VIDEO_ENABLED" >> "$RELEASE_FILE"
[ -z "$GUEST_DAILY_LIMIT_ENABLED" ] || printf 'ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=%s\n' "$GUEST_DAILY_LIMIT_ENABLED" >> "$RELEASE_FILE"
[ -z "$PRACTICE_REMINDER_ENABLED" ] || printf 'ACTTUB_PRACTICE_REMINDER_ENABLED=%s\n' "$PRACTICE_REMINDER_ENABLED" >> "$RELEASE_FILE"
[ -z "$CPU_SHARES" ] || printf 'API_CPU_SHARES=%s\nWEB_CPU_SHARES=%s\nPRON_CPU_SHARES=%s\n' "$CPU_SHARES" "$CPU_SHARES" "$CPU_SHARES" >> "$RELEASE_FILE"
# --no-env-resolution 은 첫 배포의 아직 없는 release.env 를 읽지 않고 치환과 활성 프로필만 검증한다.
services="$(compose config --no-env-resolution --services)" || fail "compose 설정 검증에 실패했다"
grep -qx proxy <<< "$services" || fail "compose.yml 에 proxy 서비스가 없다 — deploy.sh 와 compose.yml 은 같은 커밋의 것이어야 한다"
release_services=(api web)
if grep -qx backup <<< "$services"; then
  [ -n "$BACKUP_IMAGE" ] || fail "backup 프로필에는 4번째 인자 또는 BACKUP_IMAGE 가 필요하다"
  release_services+=(backup)
fi
tunnel=false backup_service=""
if grep -qx cloudflared <<< "$services"; then tunnel=true; fi
if grep -qx backup <<< "$services"; then backup_service=backup; fi
# 새 판으로 넘어가기 전에 실패하면 이 사본으로 되돌린다(undo).
if [ -f release.env ]; then cp -p release.env release.env.prev; else rm -f release.env.prev; fi
mv -f "$RELEASE_FILE" release.env
release_tmp=""
RELEASE_FILE=release.env

# ── 2. 이미지 확보 ─────────────────────────────────────────────────────────────
# 이번 릴리스의 api·web 과 활성화된 backup 이미지만 당긴다. db(postgres:18-alpine)·cloudflared·proxy 는 여기서 당기지 않는다 —
# always 로 당기면 상류 태그가 움직인 날 앱 배포에 그 컨테이너의 재생성이 섞인다. 없을 때는 아래 up 이 받는다(up 의 기본
# pull 정책이 missing). 그것들을 올리는 것은 compose.yml 의 태그를 바꾸는 별개의 일이고, 그 배포는 그 컨테이너를 다시 만든다.
phase=rolling
step "이미지 확보 (compose pull --policy $PULL_POLICY ${release_services[*]})"
compose pull --policy "$PULL_POLICY" "${release_services[@]}" \
  || fail "이미지를 받지 못했다 — 태그가 GHCR 에 있는지, missing 정책이면 로컬에 있는지 본다"

# ── 3. db ──────────────────────────────────────────────────────────────────────
step "db (compose up -d --no-deps --wait db, 최대 ${WAIT_SECONDS}초)"
compose up -d --no-deps --wait --wait-timeout "$WAIT_SECONDS" db || fail "db 가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다"

# ── 4. 바뀐 api·web 을 옛 것 옆에 띄운다 ───────────────────────────────────────
# roll <서비스> <이미지> → rolled_old(지금 proxy 가 넘겨주는 컨테이너)·rolled_new(넘길 컨테이너).
roll() {
  local svc="$1" want want_image ids id target keep=""
  want="$(fingerprint "$svc")" || fail "$svc 의 설정 지문을 구하지 못했다"
  want_image="$(docker image inspect -f '{{.Id}}' "$2")" || fail "$svc 의 이미지 ID를 읽지 못했다"
  ids="$(compose ps -a -q "$svc")" || fail "$svc 컨테이너 목록을 읽지 못했다"
  target="$(active_name "$svc")"
  # 옛 판은 proxy 가 넘겨주는 healthy 컨테이너다. active.conf 가 없거나(이 방식의 첫 배포) 가리키는 컨테이너가 없으면
  # healthy 인 첫 컨테이너 — 응답하는 컨테이너를 찌꺼기로 지우지 않는다.
  for id in $ids; do
    [ "$(state_of "$id")" = healthy ] || continue
    [ -n "$keep" ] || keep="$id"
    if [ "$(name_of "$id")" = "$target" ]; then keep="$id"; break; fi
  done
  # 그 밖의 컨테이너는 요청을 받지 않는다(죽었거나 중단된 배포가 남긴 것). 지워야 --scale 이 하나만 더 만든다.
  for id in $ids; do
    [ "$id" = "$keep" ] || docker rm -f "$id" >/dev/null || fail "남은 $svc 컨테이너를 지우지 못했다: $id"
  done
  rolled_old="$keep" rolled_new="$keep" rolled_old_hash="$(active_hash "$svc")" rolled_new_hash="$want"
  # 바뀐 것이 없다 = proxy 가 넘겨주는 그 컨테이너를 만들 때 active.conf 에 적어 둔 지문이 지금 것과 같다. 컨테이너 라벨과
  # 견주지 않는다 — Compose 2.38 은 env_file 이 있는 서비스(api)에서 config --hash 가 라벨과 늘 달라 매번 새 판을 띄웠다.
  # 같은 태그를 다시 빌드한 경우 설정 지문은 같아도 pull한 이미지와 실행 이미지가 다르다.
  if [ -n "$keep" ] && [ "$(name_of "$keep")" = "$target" ] && [ "$rolled_old_hash" = "$want" ] \
    && [ "$(docker inspect -f '{{.Image}}' "$keep")" = "$want_image" ]; then
    echo "  $svc 그대로 — $(name_of "$keep")"
    return 0
  fi
  if [ -n "$keep" ]; then
    compose up -d --no-deps --no-recreate --scale "$svc=2" "$svc" || fail "$svc 새 컨테이너를 만들지 못했다"
  else
    # 넘겨받을 healthy 컨테이너가 없다(첫 배포·죽은 판) — 겹치지 않고 바로 만든다.
    compose up -d --no-deps "$svc" || fail "$svc 컨테이너를 만들지 못했다"
  fi
  rolled_new="$(compose ps -a -q "$svc" | grep -vx -- "${keep:-none}" || true)"
  [ "$(printf '%s\n' "$rolled_new" | grep -c .)" = 1 ] || fail "$svc 의 새 컨테이너를 하나로 가려내지 못했다: $rolled_new"
  created="$created $rolled_new"
  echo "  $svc 새 컨테이너 $(name_of "$rolled_new")${keep:+ (옛 $(name_of "$keep") 는 그대로 응답)}"
}

step "설정이나 이미지가 바뀐 api·web 을 옛 것 옆에 띄운다"
roll api "$API_IMAGE"; old_api="$rolled_old" new_api="$rolled_new" old_api_hash="$rolled_old_hash" new_api_hash="$rolled_new_hash"
roll web "$WEB_IMAGE"; old_web="$rolled_old" new_web="$rolled_new" old_web_hash="$rolled_old_hash" new_web_hash="$rolled_new_hash"

wait_healthy() {
  local deadline=$((SECONDS + WAIT_SECONDS)) id st
  for id in "$@"; do
    while :; do
      st="$(state_of "$id")" || return 1
      [ "$st" != healthy ] || break
      case "$st" in unhealthy|exited|dead) return 1 ;; esac
      [ "$SECONDS" -lt "$deadline" ] || return 1
      sleep 2
    done
  done
}
if [ -n "$created" ]; then
  step "새 컨테이너 healthy 대기 (최대 ${WAIT_SECONDS}초)"
  # shellcheck disable=SC2086 # created 는 공백으로 가른 컨테이너 ID 목록이다.
  wait_healthy $created || fail "새 컨테이너가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다 — 옛 판을 그대로 둔다"
fi

# ── 5. proxy 를 새 컨테이너로 넘긴다 ───────────────────────────────────────────
step "proxy 넘기기 — web $(name_of "$new_web"), api $(name_of "$new_api")"
# active.conf 를 쓰는 순간부터는 실패하면 옛 컨테이너로 다시 써야 한다(undo). 남겨 두면 다음 배포가 엉뚱한 컨테이너를 옛 판으로 본다.
phase=switched
write_active "$(name_of "$new_web")" "$(name_of "$new_api")" "$new_web_hash" "$new_api_hash" || fail "proxy/active.conf 를 쓰지 못했다"
old_workers=""
proxy_id="$(compose ps -q proxy)"
# proxy 는 env_file 이 없어 라벨과 config --hash 가 Compose 버전과 무관하게 같다(roll 의 주석 참고).
if [ -n "$proxy_id" ] && [ "$(state_of "$proxy_id")" = healthy ] && [ "$(hash_of "$proxy_id")" = "$(want_hash proxy)" ]; then
  # reload 뒤에도 옛 worker 는 이미 받은 요청을 옛 판으로 보낸다. 그것들이 끝나야 옛 컨테이너를 멈출 수 있다(8단계).
  old_workers="$(compose exec -T proxy pgrep -f 'nginx: worker process' | tr '\n' ' ')" || fail "proxy 의 nginx worker 를 읽지 못했다"
  nginx_cmd -t -q || fail "proxy 설정 검사(nginx -t)가 실패했다"
  nginx_cmd -s reload || fail "proxy reload 가 실패했다"
  # reload 는 신호만 보내고 돌아온다. 손님을 받는 worker 가 모두 새 것이 된 뒤에 대조한다 — 그 전에 물으면 옛 worker 가 옛 판의
  # 답으로 대조를 통과시킬 수 있다(같은 sha 로 .env 만 바꿔 다시 배포할 때 실제로 그랬다, SOMA-700 smoke).
  wait_reloaded || fail "proxy 의 옛 worker 가 10초 안에 손님 받기를 멈추지 않았다"
else
  # 처음이거나 proxy 의 이미지·설정이 바뀌었다 — 다시 만드는 동안은 끊긴다.
  compose up -d --no-deps --wait --wait-timeout "$WAIT_SECONDS" proxy || fail "proxy 가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다"
fi

# ── 6. /health 의 commit 대조 (proxy 경유) ──────────────────────────────────────
# 호스트 포트를 publish 하지 않으므로 proxy 컨테이너 안에서 부른다. proxy → web(rewrites) → proxy → api 라 터널이 보는 길과
# 같다. reload 는 신호만 보내고 돌아오므로 새 worker 가 받을 때까지 잠깐 다시 묻는다.
step "proxy 경유 GET /health 의 commit 대조 (기대 ${SHA:0:7})"
got="" body=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  body="$(compose exec -T proxy wget -q -O - http://127.0.0.1:3000/health 2>/dev/null)" || body=""
  got="$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' <<< "$body")"
  [ "$got" != "${SHA:0:7}" ] || break
  sleep 0.5
done
echo "  ${body:-응답 없음}"
[ "$got" = "${SHA:0:7}" ] \
  || fail "proxy 경유 /health 의 commit(${got:-없음})이 배포한 sha(${SHA:0:7})와 다르다 — 옛 판으로 되돌린다. 아래 새 컨테이너 로그를 본다"
phase=committed
rm -f release.env.prev

# ── 7. 터널 ────────────────────────────────────────────────────────────────────
# 옛 컨테이너를 내리기 전에 맞춘다 — cloudflared 의 망이 바뀌는 배포(SOMA-700 첫 배포)에서는 옛 cloudflared 가 옛 web 으로
# 직접 가고, 다시 만들어진 cloudflared 가 proxy 로 간다.
if [ "$tunnel" = true ]; then
  step "터널 맞추기 (compose up -d --no-deps --wait cloudflared)"
  compose up -d --no-deps --wait --wait-timeout "$WAIT_SECONDS" cloudflared \
    || fail "cloudflared 가 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다 — web·api 는 이미 새 판이다"
fi

# ── 8. 옛 판 내리기 ────────────────────────────────────────────────────────────
drain_workers || fail "nginx worker 의 요청 마무리를 확인하지 못했다 — 옛 컨테이너를 남긴다"
for id in $([ "$old_api" = "$new_api" ] || echo "$old_api") $([ "$old_web" = "$new_web" ] || echo "$old_web"); do
  step "옛 컨테이너 내리기 — $(name_of "$id")"
  { docker stop "$id" >/dev/null && docker rm "$id" >/dev/null; } || fail "옛 컨테이너를 내리지 못했다: $id — web·api 는 이미 새 판이다"
done

# ── 9. backup·남은 컨테이너 ────────────────────────────────────────────────────
step "backup·고아 컨테이너 맞추기 (compose up -d --no-deps --remove-orphans --wait db${backup_service:+ $backup_service})"
# shellcheck disable=SC2086 # backup_service 는 비었거나 서비스 이름 하나다.
compose up -d --no-deps --remove-orphans --wait --wait-timeout "$WAIT_SECONDS" db $backup_service \
  || fail "backup 이 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다 — web·api 는 이미 새 판이다"

# ── 10. 기능 스위치 대조 ────────────────────────────────────────────────────────
if [ -n "$THREE_LAYERS_ENABLED" ]; then
  actual_three_layers="$(compose exec -T api printenv ACTTUB_THREE_LAYERS_ENABLED)" \
    || fail "새 연습 경로의 컨테이너 설정을 읽지 못했다"
  [ "$actual_three_layers" = "$THREE_LAYERS_ENABLED" ] \
    || fail "새 연습 경로 설정이 반영되지 않았다 (기대 $THREE_LAYERS_ENABLED)"
  step "새 연습 경로 확인: $actual_three_layers"
fi

if [ -n "$GUEST_DAILY_LIMIT_ENABLED" ]; then
  actual_guest_limit="$(compose exec -T api printenv ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED)" \
    || fail "게스트 일일 분석 한도 설정을 읽지 못했다"
  [ "$actual_guest_limit" = "$GUEST_DAILY_LIMIT_ENABLED" ] \
    || fail "게스트 일일 분석 한도 설정이 반영되지 않았다"
  step "게스트 일일 분석 한도 확인: $actual_guest_limit"
fi

if [ -n "$PRACTICE_REMINDER_ENABLED" ]; then
  actual_practice_reminder="$(compose exec -T api printenv PRACTICE_REMINDER_ENABLED)" \
    || fail "연습 알림 설정을 읽지 못했다"
  [ "$actual_practice_reminder" = "$PRACTICE_REMINDER_ENABLED" ] \
    || fail "연습 알림 설정이 반영되지 않았다 (기대 $PRACTICE_REMINDER_ENABLED)"
  step "연습 알림 확인: $actual_practice_reminder"
fi

if [ -n "$DIRECT_VIDEO_ENABLED" ]; then
  actual_direct_video="$(compose exec -T api printenv ACTTUB_DIRECT_VIDEO_ENABLED)" \
    || fail "Gemini 직접 코칭의 컨테이너 설정을 읽지 못했다"
  [ "$actual_direct_video" = "$DIRECT_VIDEO_ENABLED" ] \
    || fail "Gemini 직접 코칭 설정이 반영되지 않았다"
  step "Gemini 직접 코칭 확인: $actual_direct_video"
fi

# ── 11. 옛 릴리스 이미지 정리 ──────────────────────────────────────────────────
# 배포마다 sha 태그 이미지가 남아 디스크를 채운다. 이번 이미지와 같은 저장소에서 릴리스 태그(<sha>·<env>-<sha>)만
# 지우고, smoke.sh 의 로컬 태그(옆 실행이 쓰는 중일 수 있다)는 건드리지 않는다. -f 없는 rm 은 컨테이너가 쓰는
# 이미지를 거부하므로 같은 데몬의 다른 환경이 띄운 이미지는 남는다. 다른 환경이 pull 한 뒤 up 전에 지워져도
# up 이 없는 이미지를 다시 받는다.
step "옛 릴리스 이미지 정리"
for image in "$API_IMAGE" "$WEB_IMAGE" ${BACKUP_IMAGE:+"$BACKUP_IMAGE"}; do
  repo="${image%:*}"
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" 2>/dev/null | while read -r old; do
    [[ "$old" =~ ^"$repo":([a-z]+-)?[0-9a-f]{7,40}$ ]] && [ "$old" != "$image" ] || continue
    docker image rm "$old" >/dev/null 2>&1 && echo "  지움 $old" || true
  done || true
done

printf '✔ 배포 완료 — %s commit %s\n' "$(basename "$PWD")" "${SHA:0:7}"
