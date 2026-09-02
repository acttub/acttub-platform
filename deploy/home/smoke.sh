#!/usr/bin/env bash
# 홈서버 compose 스택의 스모크 테스트 — web + api + db 범위.
#
#   deploy/home/smoke.sh            # 어느 디렉토리에서 실행해도 된다
#   SMOKE_KEEP=1 deploy/home/smoke.sh   # 실패 원인을 보려고 스택·이미지를 남긴다
#
# 무엇을 판정하나 (SOMA-489 조각 01·02 수락 조건)
#   1. apps/api 의 jar 로 API 이미지가 빌드되고 ffmpeg·ffprobe 가 안에 있다
#   2. 저장소 루트를 컨텍스트로 웹 이미지가 build-arg(사이트 URL·Sentry·Amplitude·커밋)를 받아 빌드되고,
#      안에는 standalone·.next/static·public 만 있다 — 소스 트리·.env 가 없고 prebuild 산출물(ort wasm·
#      Pretendard)이 들어 있으며 non-root 로 돈다
#   3. 빈 Postgres 18 볼륨에서 api → web 순으로 healthy 가 된다 (Flyway 는 api 기동의 일부)
#   4. api 컨테이너 안에서 curl /health → 200, "status":"ok", services 목록, commit == RENDER_GIT_COMMIT 앞 7자
#      (호스트 포트를 publish 하지 않으므로 밖에서는 못 부른다 — 그것도 여기서 확인한다)
#   5. web 컨테이너 안에서 GET / → 200, GET /health → 200 이고 본문이 api 의 것과 같다(rewrites 가
#      http://api:8080 으로 넘긴다), /ort/*·/fonts/pretendard/* → 200
#   6. Flyway 로그에 V1 부터 db/migration 의 최대 번호까지 적용됐다
#   7. 필수 env 하나가 빠지면 compose 가 컨테이너를 만들기 전에 이름을 찍고 거부한다
#
# 로컬(맥)에서도 CI(ubuntu)에서도 같은 명령으로 돌 수 있게 짰다. 저장소 루트는 스크립트 위치로
# 찾고, 임시 파일은 mktemp 로 만들며, 프로젝트명·이미지 태그에 pid 를 붙여 옆 실행과 섞이지 않는다.
# 뒤따르는 SOMA-489 조각이 deploy.sh 경유·CI 스텝으로 이 스크립트를 확장한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="$ROOT/deploy/home"
API_DIR="$ROOT/apps/api"
MIGRATIONS="$API_DIR/src/main/resources/db/migration"

PROJECT="soma489-smoke-$$"
IMAGE="acttub-api:$PROJECT"
WEB_IMAGE="acttub-web:$PROJECT"
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
    printf '\n(SMOKE_KEEP=1) 남겨 둔 것: 프로젝트 %s, 이미지 %s·%s, 디렉토리 %s\n' "$PROJECT" "$IMAGE" "$WEB_IMAGE" "$WORK"
    return $status
  fi
  step "정리 (down -v, 이미지 삭제)"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" "$WEB_IMAGE" >/dev/null 2>&1 || true
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
# assert_non_root <이미지> → uid 를 찍고 0 이면 fail. api·web 이미지가 같은 검사를 받는다.
assert_non_root() {
  local uid
  uid="$(docker run --rm --entrypoint id "$1" -u)"
  [ "$uid" != "0" ] || fail "$1 이 root(uid 0)로 돈다"
  echo "  uid=$uid"
}
assert_non_root "$IMAGE"

# ── 1b. 웹 이미지 (컨텍스트 = 저장소 루트, 워크스페이스 lockfile 때문) ──────────
# 커밋은 아래 2 단계의 COMMIT 과 같은 값이어야 /health 대조가 성립하므로 여기서 먼저 정한다.
COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 0123456789abcdef0123456789abcdef01234567)"

step "웹 이미지 빌드 → $WEB_IMAGE (컨텍스트 $ROOT, build-arg 는 테스트 값)"
# build-arg 를 받아 빌드가 통과하는지를 본다. 값이 번들까지 갔는지는 아래 5b 에서 사이트 URL 하나로
# 확인한다(랜딩 HTML 의 canonical·og:url 에 새겨진다). 호스트는 전부 .invalid — DSN 으로 에러가 나도
# 어디로도 가지 않는다. SENTRY_AUTH_TOKEN 시크릿은 일부러 안 넘긴다: 없을 때 소스맵 업로드를 건너뛰고
# 통과해야 한다.
SITE_URL=https://smoke.acttub.invalid
docker build --quiet -t "$WEB_IMAGE" -f "$ROOT/apps/web/Dockerfile" \
  --build-arg API_ORIGIN=http://api:8080 \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  --build-arg NEXT_PUBLIC_SENTRY_DSN=https://smoke@sentry.invalid/1 \
  --build-arg NEXT_PUBLIC_SENTRY_ENV=smoke \
  --build-arg NEXT_PUBLIC_AMPLITUDE_API_KEY=smoke-amplitude-key \
  --build-arg NEXT_PUBLIC_APP_COMMIT="$COMMIT" \
  "$ROOT" >/dev/null

step "웹 이미지 안: standalone·static·public 만 있고 소스·.env 가 없다, non-root"
# 런타임 이미지는 node 만 있다(curl 없음). CMD 가 node server.js 라 --entrypoint 로 sh 를 부른다.
web_sh() { docker run --rm --entrypoint sh "$WEB_IMAGE" -c "$1"; }
web_sh 'test -f /app/apps/web/server.js' || fail "standalone 의 server.js 가 없다"
web_sh 'test -d /app/apps/web/.next/static' || fail ".next/static 이 없다(스타일 없는 화면이 뜬다)"
web_sh 'test -f /app/apps/web/public/ort/ort-wasm-simd-threaded.wasm' \
  || fail "public/ort 가 없다 — prebuild(copy-ort.mjs)가 이미지 빌드 안에서 돌지 않았다"
# 디렉토리가 없으면 ls 가 비영이라 $(...) 가 실패한다 — || true 로 받아야 아래 fail 이 메시지를 낸다
# (pipefail 아래서 head 로 자르면 set -e 가 조용히 끝낸다). 첫 줄은 image_has 처럼 ${out%%...} 로 뽑는다.
out="$(web_sh 'ls /app/apps/web/public/fonts/pretendard 2>/dev/null' || true)"
font_ver="${out%%$'\n'*}"
[ -n "$font_ver" ] || fail "public/fonts/pretendard 가 없다 — prebuild(copy-pretendard.mjs)가 돌지 않았다"
echo "  server.js · .next/static · public/ort · public/fonts/pretendard/$font_ver"
# standalone 에는 Next 가 트레이싱한 데이터 파일 둘이 원래 경로 그대로 들어온다 — OG 이미지 폰트
# (src/lib/seo/fonts/og-font-subset.ttf)와 /admissions 의 notices.json(../api/src/main/resources/...).
# 그래서 src/ 디렉토리 유무가 아니라 소스 파일(.ts/.tsx)·next.config·tests·.git·.env 의 유무로 판정한다.
leaked="$(web_sh 'find /app/apps -path "*/node_modules" -prune -o \( -name "*.ts" -o -name "*.tsx" -o -name "next.config.*" \) -print; for p in /app/apps/web/tests /app/.git; do [ -e "$p" ] && echo "$p"; done; find /app -name ".env*" -print; true')"
[ -z "$leaked" ] || fail "이미지에 소스·설정·.env 가 들어갔다: $leaked"
echo "  소스·설정·.env 없음"
assert_non_root "$WEB_IMAGE"

# ── 2. 테스트용 env ─────────────────────────────────────────────────────────────
# 가짜 값으로 충분해야 한다 — 기동에 실제 외부 호출이 필요하면 이 단계에서 드러난다.
# 웹은 런타임 env 를 받지 않는다(설정은 이미지에 굳어 있다). 그래서 .env 에 웹 몫 키가 없다.
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
WEB_IMAGE=$WEB_IMAGE
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
step "compose up (프로젝트 $PROJECT, 빈 볼륨) → api·web healthy 대기(최대 180초)"
compose up -d --wait --wait-timeout 180 || {
  compose ps
  compose logs --no-color api | tail -60
  compose logs --no-color web | tail -30
  fail "api·web 이 180초 안에 healthy 가 되지 않았다"
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

# ── 5b. 웹 경유 (web 컨테이너 안에서) ──────────────────────────────────────────
# 웹 이미지에는 curl 이 없어 node 의 fetch 로 부른다. 서버는 HOSTNAME=0.0.0.0(IPv4)에 묶이므로
# localhost 가 ::1 로 풀리는 경우를 피해 127.0.0.1 로 간다.
# web_get <경로> → 첫 줄 "<상태> <content-type> <바이트>", 그 뒤 본문. 본문은 text/*·json 일 때만 보낸다(앞 200KB
# — 랜딩 HTML·CSS 는 다 들어온다). wasm 같은 이진은 상태 줄만 — NUL 이 $(...) 로 들어오면 bash 5 가 경고를 찍는다.
web_get() {
  compose exec -T web node --input-type=module -e '
    const path = process.argv[1];
    const r = await fetch("http://127.0.0.1:3000" + path);
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") ?? "-";
    process.stdout.write(`${r.status} ${type} ${buf.length}\n`);
    if (/^(text\/|application\/json)/.test(type)) process.stdout.write(buf.subarray(0, 200_000).toString("utf8"));
  ' -- "$1"
}
# expect_web <경로> <설명> → 200 이 아니면 fail. 본문은 전역 web_body 에 남긴다.
expect_web() {
  local path="$1" what="$2" out status_line
  out="$(web_get "$path")" || fail "web 컨테이너 안에서 GET $path 가 실패했다"
  status_line="${out%%$'\n'*}"
  web_body="${out#*$'\n'}"
  echo "  GET $path → $status_line"
  [ "${status_line%% *}" = "200" ] || fail "$what: GET $path 가 ${status_line%% *} 를 줬다"
}

step "web 컨테이너 안에서 GET / (프리렌더된 랜딩) — build-arg 사이트 URL 이 HTML 에 새겨졌다"
expect_web / "랜딩"
printf '%s' "$web_body" | grep -qi '<html' || fail "/ 의 본문이 HTML 이 아니다"
printf '%s' "$web_body" | grep -q "$SITE_URL" \
  || fail "/ 의 HTML 에 NEXT_PUBLIC_SITE_URL($SITE_URL)이 없다 — build-arg 가 번들에 들어가지 않았다"

step "web 컨테이너 안에서 GET /health — rewrites 가 api:8080 으로 넘겨 본문이 api 의 것과 같다"
expect_web /health "rewrites"
[ "$web_body" = "$json" ] || fail "web 경유 /health 본문이 api 의 것과 다르다: $web_body"

step "prebuild 산출물이 서빙된다 — /ort/*, /fonts/pretendard/*"
expect_web /ort/ort-wasm-simd-threaded.wasm "onnxruntime wasm"
expect_web "/fonts/pretendard/$font_ver/pretendard.css" "Pretendard"
printf '%s' "$web_body" | grep -q '@font-face' || fail "pretendard.css 에 @font-face 가 없다"

# ── 6. Flyway: V1 부터 최신까지 ────────────────────────────────────────────────
step "Flyway 로그: V1 부터 db/migration 의 최대 버전까지 적용"
latest="$(ls "$MIGRATIONS" | grep -oE '^V[0-9]+' | tr -d V | sort -n | tail -1)"
logs="$(compose logs --no-color api)"
printf '%s\n' "$logs" | grep -E 'Migrating schema "public" to version "1 ' >/dev/null \
  || fail "V1 적용 로그가 없다"
now_at="$(printf '%s\n' "$logs" | grep -oE 'now at version v[0-9]+' | tail -1 | grep -oE '[0-9]+$' || true)"
[ "$now_at" = "$latest" ] || fail "Flyway 가 v$latest 가 아니라 v${now_at:-?} 에서 멈췄다"
printf '%s\n' "$logs" | grep -E 'Migrating schema|Successfully applied' | sed 's/^/  /'

printf '\n✔ 스모크 통과 — api·web 이미지·compose(web+api+db)·Flyway v1→v%s·web 경유 /·/health commit %s\n' "$latest" "${COMMIT:0:7}"
