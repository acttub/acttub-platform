#!/usr/bin/env bash
# 홈서버 배포 스크립트(SOMA-489). 서버의 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다 —
# 거기에 compose.yml 과 사람이 채운 .env 가 있고, 이 스크립트가 release.env 를 쓴다.
#
#   cd /svc/acttub/dev
#   ./deploy.sh <sha> <api 이미지> <web 이미지> [backup 이미지]
#   예) ./deploy.sh 3f2a9c1e… ghcr.io/acttub/acttub-platform/api:3f2a9c1e… ghcr.io/acttub/acttub-platform/web:dev-3f2a9c1e…
#   값은 환경변수 SHA·API_IMAGE·WEB_IMAGE·BACKUP_IMAGE 로 줘도 된다(인자가 우선) — 워크플로가 ssh 로 넘길 때 어느 쪽이든 되게.
#   sha 는 7~40자 16진수.
#
# 하는 일 — 어느 단계든 실패하면 exit≠0 이고, 기동 실패는 compose ps·로그를 찍는다
#   1. 입력과 compose 를 점검한 뒤 release.env 를 새로 쓴다: API_IMAGE·WEB_IMAGE·BACKUP_IMAGE(선택)·RENDER_GIT_COMMIT·SENTRY_RELEASE.
#      사람이 관리하는 .env 는 읽기만 한다. 어느 프로필을 띄울지(cloudflared=edge·backup)도 .env 의
#      COMPOSE_PROFILES 가 정하고 이 스크립트는 그대로 따른다.
#   2. docker compose pull        DEPLOY_PULL_POLICY=always(기본)|missing — 로컬 태그로 스모크할 때 missing
#   3. docker compose up -d --remove-orphans --wait   DEPLOY_WAIT_SECONDS(기본 180) 안에 healthy 가 아니면 실패.
#      크래시루프는 healthy 가 되지 못해 여기서 시간 초과로 걸린다(ssm-deploy.sh 의 NRestarts 검사에 해당).
#   4. web 컨테이너 안에서 GET /health → commit 이 sha 앞 7자와 같은지 대조. 다르면 옛 컨테이너가 답하는 것.
#
# 같은 sha 로 다시 돌리면 release.env 내용이 같아 compose 가 아무것도 바꾸지 않고 초록으로 끝난다(멱등).
# 롤백은 이전 sha·이미지로 같은 명령을 다시 부르는 것이다.
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
[[ "$WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "DEPLOY_WAIT_SECONDS 는 양의 초 단위 정수: '$WAIT_SECONDS'"
[ -f compose.yml ] || fail "compose.yml 이 없다 — 프로젝트 디렉토리(/svc/acttub/<env>)에서 실행한다: $PWD"
[ -f .env ] || fail ".env 가 없다 — 사람이 채우는 파일이다(deploy/home/.env.example): $PWD"
command -v docker >/dev/null || fail "docker 가 없다"
docker compose version >/dev/null 2>&1 || fail "docker compose 가 없다"

RELEASE_FILE=release.env
compose() { docker compose --env-file .env --env-file "$RELEASE_FILE" "$@"; }

# 프로필은 .env 의 COMPOSE_PROFILES 가 정한다. 그 줄이 없으면 compose 는 말없이 web·api·db 만 띄우므로(터널 없음)
# 여기서 한 줄 경고한다 — 스모크의 테스트용 .env 는 일부러 그 줄이 없어 이 경고가 나온다.
grep -q '^COMPOSE_PROFILES=.' .env \
  || echo "⚠ .env 에 COMPOSE_PROFILES 가 없다 — cloudflared(edge)·backup 없이 web·api·db 만 뜬다" >&2

# ── 1. release.env ─────────────────────────────────────────────────────────────
# 임시 파일에 쓰고 mv 로 바꾼다 — 도중에 죽어도 반쯤 쓰인 release.env 가 남지 않는다.
# RENDER_GIT_COMMIT 은 /health 의 commit(HealthController, 앞 7자), SENTRY_RELEASE 는 Sentry 릴리스 태그.
# 이름이 RENDER_* 인 것은 옛 호스팅의 잔재다(ssm-deploy.sh 와 같다).
step "release.env 쓰기 — commit ${SHA:0:7}, api $API_IMAGE, web $WEB_IMAGE"
RELEASE_FILE="$(mktemp ./release.env.XXXXXX)"
trap 'rm -f "$RELEASE_FILE"' EXIT
cat > "$RELEASE_FILE" <<EOF
# deploy.sh 가 배포마다 새로 쓴다 — 손으로 고치지 않는다. 컨테이너 환경(env_file)과 compose 치환(--env-file) 둘 다 읽는다.
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
RENDER_GIT_COMMIT=$SHA
SENTRY_RELEASE=$SHA
EOF
[ -z "$BACKUP_IMAGE" ] || printf 'BACKUP_IMAGE=%s\n' "$BACKUP_IMAGE" >> "$RELEASE_FILE"
# --no-env-resolution 은 첫 배포의 아직 없는 release.env 를 읽지 않고 치환과 활성 프로필만 검증한다.
services="$(compose config --no-env-resolution --services)" || fail "compose 설정 검증에 실패했다"
release_services=(api web)
if grep -qx backup <<< "$services"; then
  [ -n "$BACKUP_IMAGE" ] || fail "backup 프로필에는 4번째 인자 또는 BACKUP_IMAGE 가 필요하다"
  release_services+=(backup)
fi
mv -f "$RELEASE_FILE" release.env
trap - EXIT
RELEASE_FILE=release.env

# ── 2. 이미지 확보 ─────────────────────────────────────────────────────────────
# 이번 릴리스의 api·web 과 활성화된 backup 이미지만 당긴다. db(postgres:18-alpine)·cloudflared 는 여기서 당기지 않는다 — always 로
# 당기면 상류 태그가 움직인 날 앱 배포에 db 재생성이 섞인다. 없을 때는 아래 up 이 받는다(up 의 기본 pull 정책이
# missing). 그 둘을 올리는 것은 compose.yml 의 태그를 바꾸거나 `compose pull db` 를 손으로 하는 별개의 일이다.
step "이미지 확보 (compose pull --policy $PULL_POLICY ${release_services[*]})"
compose pull --policy "$PULL_POLICY" "${release_services[@]}" \
  || fail "이미지를 받지 못했다 — 태그가 GHCR 에 있는지, missing 정책이면 로컬에 있는지 본다"

# ── 3. up → healthy ────────────────────────────────────────────────────────────
# --wait 는 모든 컨테이너가 healthy(healthcheck 없으면 running)가 될 때까지 기다리고, 상한을 넘기거나
# 컨테이너가 죽으면 exit 1 이다. 바뀐 서비스만 재생성된다 — release.env 값이 그대로면 아무것도 안 한다.
step "compose up -d --remove-orphans --wait (최대 ${WAIT_SECONDS}초)"
if ! compose up -d --remove-orphans --wait --wait-timeout "$WAIT_SECONDS"; then
  compose ps || true
  compose logs --no-color --tail 60 api || true
  compose logs --no-color --tail 30 web || true
  fail "compose up 이 실패했거나 ${WAIT_SECONDS}초 안에 healthy 가 되지 않았다 — 위 ps·로그를 본다"
fi

# ── 4. /health 의 commit 대조 (web 경유) ───────────────────────────────────────
# 호스트 포트를 publish 하지 않으므로 컨테이너 안에서 부른다. 런타임 웹 이미지에는 curl 이 없어 node 의
# fetch 로 간다(compose healthcheck 와 같다). web → rewrites → api 경로 그대로라 사용자가 보는 것과 같다.
# 첫 줄 "<상태> <commit>", 그 뒤 본문.
step "web 경유 GET /health 의 commit 대조 (기대 ${SHA:0:7})"
out="$(compose exec -T web node --input-type=module -e '
  const r = await fetch("http://127.0.0.1:3000/health");
  const text = await r.text();
  let commit = "";
  try { commit = String(JSON.parse(text).commit ?? ""); } catch {}
  process.stdout.write(`${r.status} ${commit}\n${text}`);
')" || fail "web 컨테이너 안에서 GET /health 를 부르지 못했다"
status_line="${out%%$'\n'*}"
status="${status_line%% *}"
got="${status_line#* }"
echo "  $status ${out#*$'\n'}"
[ "$status" = "200" ] || fail "web 경유 /health 가 $status 를 줬다"
[ "$got" = "${SHA:0:7}" ] \
  || fail "/health 의 commit($got)이 배포한 sha(${SHA:0:7})와 다르다 — 옛 컨테이너가 답하고 있다. compose ps 로 api 의 생성 시각과 이미지를 본다"

printf '✔ 배포 완료 — %s commit %s\n' "$(basename "$PWD")" "${SHA:0:7}"
