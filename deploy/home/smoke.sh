#!/usr/bin/env bash
# 홈서버 compose 스택의 스모크 테스트 — api + db 범위.
#
#   deploy/home/smoke.sh            # 어느 디렉토리에서 실행해도 된다
#   SMOKE_KEEP=1 deploy/home/smoke.sh   # 실패 원인을 보려고 스택·이미지를 남긴다
#
# 무엇을 판정하나 (SOMA-489 조각 01 수락 조건)
#   1. apps/api 의 jar 로 API 이미지가 빌드되고 ffmpeg·ffprobe 가 안에 있다
#   2. 빈 Postgres 18 볼륨에서 api 가 healthy 가 된다 (Flyway 는 기동의 일부)
#   3. 컨테이너 안에서 curl /health → 200, "status":"ok", services 목록, commit == RENDER_GIT_COMMIT 앞 7자
#      (호스트 포트를 publish 하지 않으므로 밖에서는 못 부른다 — 그것도 여기서 확인한다)
#   4. Flyway 로그에 V1 부터 db/migration 의 최대 번호까지 적용됐다
#   5. 필수 env 하나가 빠지면 compose 가 컨테이너를 만들기 전에 이름을 찍고 거부한다
#
# 로컬(맥)에서도 CI(ubuntu)에서도 같은 명령으로 돌 수 있게 짰다. 저장소 루트는 스크립트 위치로
# 찾고, 임시 파일은 mktemp 로 만들며, 프로젝트명·이미지 태그에 pid 를 붙여 옆 실행과 섞이지 않는다.
# 뒤따르는 SOMA-489 조각이 web 경유·deploy.sh 경유·CI 스텝으로 이 스크립트를 확장한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="$ROOT/deploy/home"
API_DIR="$ROOT/apps/api"
MIGRATIONS="$API_DIR/src/main/resources/db/migration"

PROJECT="soma489-smoke-$$"
IMAGE="acttub-api:$PROJECT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/$PROJECT.XXXXXX")"

# compose 는 두 곳에서 env 를 읽는다 — 파일 안 ${...} 치환은 --env-file 로, 컨테이너 환경은
# compose.yml 의 env_file 로. 둘 다 같은 두 파일을 가리켜야 한다.
# compose_with <.env 경로> <compose 인자...>  — 3단계가 다른 .env 로 같은 명령을 부른다.
compose_with() {
  local env_file="$1"; shift
  docker compose -p "$PROJECT" -f "$HOME_DIR/compose.yml" \
    --project-directory "$WORK" \
    --env-file "$env_file" --env-file "$WORK/release.env" "$@"
}
compose() { compose_with "$WORK/.env" "$@"; }

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

cleanup() {
  local status=$?
  if [ "${SMOKE_KEEP:-}" = "1" ]; then
    printf '\n(SMOKE_KEEP=1) 남겨 둔 것: 프로젝트 %s, 이미지 %s, 디렉토리 %s\n' "$PROJECT" "$IMAGE" "$WORK"
    return $status
  fi
  step "정리 (down -v, 이미지 삭제)"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  return $status
}
trap cleanup EXIT

command -v docker >/dev/null || fail "docker 가 없다"
docker compose version >/dev/null 2>&1 || fail "docker compose 가 없다"

# ── 1. jar → 이미지 ─────────────────────────────────────────────────────────────
step "jar 빌드 (apps/api ./gradlew bootJar)"
(cd "$API_DIR" && ./gradlew --quiet --console=plain bootJar)
[ -f "$API_DIR/build/libs/acting-api.jar" ] || fail "jar 가 없다: apps/api/build/libs/acting-api.jar"

step "이미지 빌드 → $IMAGE (컨텍스트 apps/api)"
docker build --quiet -t "$IMAGE" "$API_DIR" >/dev/null

step "이미지 안에 ffmpeg·ffprobe·curl 이 있고 non-root 로 돈다"
# ENTRYPOINT 가 java 라 --entrypoint 로 바꿔 부른다. 첫 줄만 보여 준다(head 는 pipefail 과 충돌).
image_has() {
  local cmd="$1" out; shift
  out="$(docker run --rm --entrypoint "$cmd" "$IMAGE" "$@" 2>/dev/null)" || fail "이미지 안에 $cmd 가 없다"
  printf '  %s\n' "${out%%$'\n'*}"
}
image_has ffmpeg -version
image_has ffprobe -version
image_has curl --version
uid="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[ "$uid" != "0" ] || fail "컨테이너가 root(uid 0)로 돈다"
echo "  uid=$uid"

# ── 2. 테스트용 env ─────────────────────────────────────────────────────────────
# 가짜 값으로 충분해야 한다 — 기동에 실제 외부 호출이 필요하면 이 단계에서 드러난다.
COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 0123456789abcdef0123456789abcdef01234567)"
cat > "$WORK/.env" <<ENV
COMPOSE_PROJECT_NAME=$PROJECT
POSTGRES_PASSWORD=smoke-pw
JWT_SECRET=smoke-jwt-secret
ADMIN_OPS_TOKEN=smoke-admin-token
GEMINI_API_KEY=smoke-gemini-key
OPENAI_API_KEY=smoke-openai-key
S3_BUCKET=smoke-bucket
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=SMOKEACCESSKEY
AWS_SECRET_ACCESS_KEY=smoke-secret-key
ENV
cat > "$WORK/release.env" <<ENV
API_IMAGE=$IMAGE
RENDER_GIT_COMMIT=$COMMIT
SENTRY_RELEASE=$COMMIT
ENV

# ── 3. 필수 env 누락 → compose 가 거부 ──────────────────────────────────────────
step "필수 env(ADMIN_OPS_TOKEN)를 빼면 compose 가 이름을 찍고 거부한다"
grep -v '^ADMIN_OPS_TOKEN=' "$WORK/.env" > "$WORK/.env.missing"
if out="$(compose_with "$WORK/.env.missing" config --quiet 2>&1)"; then
  fail "ADMIN_OPS_TOKEN 없이도 compose config 가 통과했다"
fi
printf '%s\n' "$out" | grep -q 'ADMIN_OPS_TOKEN' || fail "거부 메시지에 ADMIN_OPS_TOKEN 이 없다: $out"
printf '  %s\n' "${out%%$'\n'*}"

# ── 4. up → healthy ─────────────────────────────────────────────────────────────
step "compose up (프로젝트 $PROJECT, 빈 볼륨) → api healthy 대기(최대 180초)"
compose up -d --wait --wait-timeout 180 || {
  compose ps
  compose logs --no-color api | tail -60
  fail "api 가 180초 안에 healthy 가 되지 않았다"
}
compose ps

step "호스트 포트를 publish 하지 않는다"
# EXPOSE 만 된 포트는 "8080/tcp", 호스트에 묶인 포트는 "0.0.0.0:8080->8080/tcp" 로 나온다.
published="$(compose ps --format '{{.Name}} {{.Ports}}' | grep -- '->' || true)"
[ -z "$published" ] || fail "호스트에 publish 된 포트가 있다: $published"
compose ps --format '  {{.Name}} {{.Ports}}'

# ── 5. /health (컨테이너 안에서) ───────────────────────────────────────────────
step "컨테이너 안에서 GET /health"
body="$(compose exec -T api curl -sS -w '\n%{http_code}' http://localhost:8080/health)"
code="${body##*$'\n'}"
json="${body%$'\n'*}"
echo "  $code $json"
[ "$code" = "200" ] || fail "/health 가 $code 를 줬다"
printf '%s' "$json" | grep -q '"status":"ok"' || fail "status 가 ok 가 아니다"
printf '%s' "$json" | grep -Eq '"services":\["[a-z]+"' || fail "services 목록이 비었다"
printf '%s' "$json" | grep -q "\"commit\":\"${COMMIT:0:7}\"" || fail "commit 이 ${COMMIT:0:7} 이 아니다"

# ── 6. Flyway: V1 부터 최신까지 ────────────────────────────────────────────────
step "Flyway 로그: V1 부터 db/migration 의 최대 버전까지 적용"
latest="$(ls "$MIGRATIONS" | grep -oE '^V[0-9]+' | tr -d V | sort -n | tail -1)"
logs="$(compose logs --no-color api)"
printf '%s\n' "$logs" | grep -E 'Migrating schema "public" to version "1 ' >/dev/null \
  || fail "V1 적용 로그가 없다"
now_at="$(printf '%s\n' "$logs" | grep -oE 'now at version v[0-9]+' | tail -1 | grep -oE '[0-9]+$' || true)"
[ "$now_at" = "$latest" ] || fail "Flyway 가 v$latest 가 아니라 v${now_at:-?} 에서 멈췄다"
printf '%s\n' "$logs" | grep -E 'Migrating schema|Successfully applied' | sed 's/^/  /'

printf '\n✔ 스모크 통과 — api 이미지·compose(api+db)·Flyway v1→v%s·/health commit %s\n' "$latest" "${COMMIT:0:7}"
