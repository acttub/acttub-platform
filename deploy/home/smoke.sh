#!/usr/bin/env bash
# 홈서버 compose 스택의 스모크 테스트 — 이미지 둘 + 배포 스크립트(deploy.sh) + web·api·db.
#
#   deploy/home/smoke.sh                # 어느 디렉토리에서 실행해도 된다
#   SMOKE_KEEP=1 deploy/home/smoke.sh   # 실패 원인을 보려고 스택·이미지·디렉토리를 남긴다
#   SMOKE_RESTORE=false deploy/home/smoke.sh  # 10 단계(restore-db.sh 왕복)를 건너뛴다 — CI 가 복원과 무관한 PR 에서 쓴다
#
# 로컬과 CI(ci.yml 의 smoke 잡)가 같은 명령으로 돈다. 임시 디렉토리가 서버의 프로젝트 디렉토리
# (/svc/acttub/<env>: compose.yml·.env·release.env) 노릇을 하고, 스택은 맨손 compose 가 아니라
# **실제 배포 스크립트 deploy.sh 로** 띄운다. 그래서 한 번에 Dockerfile·compose·healthcheck·rewrites·
# Flyway(빈 Postgres 에서 V1 부터)·배포 스크립트의 대기·대조 논리가 함께 걸린다.
#
# 무엇을 판정하나 (SOMA-489 조각 01·02·03·06 수락 조건) — 번호는 아래 본문의 절 번호와 같다
#   1. apps/api 의 jar 로 API 이미지가 빌드되고 ffmpeg·ffprobe·curl·tesseract(한국어) 가 안에 있으며 non-root 로 돈다
#   2. 저장소 루트를 컨텍스트로 웹 이미지가 build-arg(사이트 URL·Sentry·PostHog·커밋)를 받아 빌드되고,
#      안에는 standalone·.next/static·public 만 있다 — 소스 트리·.env 가 없고 prebuild 산출물(ort wasm·
#      Pretendard)이 들어 있으며 non-root 로 돈다
#   3. 임시 디렉토리에 compose.yml·proxy/nginx.conf 사본과 테스트용 .env 를 둔다(서버의 프로젝트 디렉토리 흉내)
#   4. deploy.sh 가 release.env 를 쓰고 → pull → up → healthy 대기 → proxy 경유 /health 의 commit 대조까지
#      초록으로 끝난다(빈 볼륨. Flyway 는 api 기동의 일부). 도는 서비스는 api·db·proxy·web 뿐이고
#      호스트 포트를 publish 하지 않는다
#   5. api 컨테이너 안에서 curl /health → 200, "status":"ok", services 목록, commit == 커밋 앞 7자
#   6. web 컨테이너 안에서 GET / → 200(사이트 URL 이 HTML 에 새겨짐), GET /health → 200 이고 본문이 api 의
#      것과 같다(rewrites 가 http://api:8080 으로 넘기고 front 망의 그 이름은 proxy 다), /ort/*·/fonts/pretendard/* → 200.
#      proxy 경유(터널이 보는 길) /health 도 같다. web 안의 api, edge 망의 web 이 proxy 하나로만 풀린다(망 별칭)
#   7. Flyway 로그에 V1 부터 db/migration 의 최대 번호까지 적용됐다
#   8. 필수 env 하나가 빠지면 compose 가 컨테이너를 만들기 전에 이름을 찍고 거부한다
#   9. 같은 sha 로 deploy.sh 를 다시 돌리면 초록이고 컨테이너가 하나도 바뀌지 않는다(멱등 — 두 번 해도 결과가 같다)
#  10. restore-db.sh 왕복 — 지금 DB 를 pg_dump -Fc 로 뜬 뒤 바꾸고 복원하면 덤프 시점으로 돌아온다(행 수·manifest 일치,
#      Flyway "up to date", 컨테이너 재생성 없음). 깨진 덤프·행 수 불일치는 exit≠0 이고 원래 DB 가 그대로다
#      (dev 이전·복원 연습·운영 컷오버가 같은 스크립트를 쓴다)
#  11. 무중단 재배포(SOMA-700) — 터널 자리에서 부하를 건 채 다른 sha 로 배포하면 실패한 요청이 0 이고, 옛 판과 새 판이
#      둘 다 응답했으며, 끝나면 api·web 이 새 컨테이너 하나씩이고 proxy 는 그대로다. 새 api 의 Flyway 는 up to date
#  12. 새 판이 healthy 가 못 되면(대기 시간 초과) exit≠0 이고 컨테이너·release.env·응답 commit 이 그대로다
#  13. 새 판이 다른 commit 을 답하면 healthy 여도 exit≠0 이고 proxy 가 옛 판으로 돌아가 있다
#      (나머지 빨강은 deploy-test.sh 가 가짜 docker 로 반증한다)
#  14. 격리된 모형 앱과 실제 nginx로 롤백 중 30초 요청·같은 태그 재빌드·재실행 무변경을 검증한다
#   cloudflared(edge)·backup(backup) 프로필은 테스트용 .env 에 COMPOSE_PROFILES 가 없어 빠진다.
#
# 저장소 루트는 스크립트 위치로 찾고, 임시 파일은 mktemp 로 만들며, 프로젝트명·이미지 태그에 pid 를
# 붙여 옆 실행과 섞이지 않는다. 실패하면 컨테이너 로그를 찍고 exit≠0, 정리는 trap 이 보장한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="$ROOT/deploy/home"
API_DIR="$ROOT/apps/api"
MIGRATIONS="$API_DIR/src/main/resources/db/migration"

PROJECT="soma489-smoke-$$"
IMAGE="acttub-api:$PROJECT"
WEB_IMAGE="acttub-web:$PROJECT"
# 서버의 /svc/acttub/<env> 노릇. compose.yml 사본·테스트용 .env 가 들어가고 release.env 는 deploy.sh 가 쓴다.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/$PROJECT.XXXXXX")"

# compose 는 두 곳에서 env 를 읽는다 — 파일 안 ${...} 치환은 --env-file 로, 컨테이너 환경은
# compose.yml 의 env_file 로. 둘 다 같은 두 파일을 가리켜야 한다. deploy.sh 도 같은 형태로 부른다.
# compose_with <.env 경로> <compose 인자...>  — 8 단계가 다른 .env 로 같은 명령을 부른다.
compose_with() {
  local env_file="$1"; shift
  docker compose -p "$PROJECT" -f "$WORK/compose.yml" \
    --project-directory "$WORK" \
    --env-file "$env_file" --env-file "$WORK/release.env" "$@"
}
compose() { compose_with "$WORK/.env" "$@"; }

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# 성공한 앱 이미지를 후속 모니터링 검사에 재사용하는 선택 기능. 기본 정리는 그대로다.
if [ -n "${SMOKE_EXPORT_API_IMAGE:-}${SMOKE_EXPORT_WEB_IMAGE:-}" ]; then
  [ -n "${SMOKE_EXPORT_API_IMAGE:-}" ] && [ -n "${SMOKE_EXPORT_WEB_IMAGE:-}" ] \
    || fail "SMOKE_EXPORT_API_IMAGE·SMOKE_EXPORT_WEB_IMAGE를 함께 지정한다"
  for export_image in "$SMOKE_EXPORT_API_IMAGE" "$SMOKE_EXPORT_WEB_IMAGE"; do
    [[ "$export_image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:-]*$ ]] || fail "내보낼 이미지 태그가 유효하지 않다"
  done
fi

cleanup() {
  local status=$?
  if [ "${SMOKE_KEEP:-}" = "1" ]; then
    printf '\n(SMOKE_KEEP=1) 남겨 둔 것: 프로젝트 %s, 이미지 %s·%s, 디렉토리 %s\n' "$PROJECT" "$IMAGE" "$WEB_IMAGE" "$WORK"
    return $status
  fi
  # 실패했으면 내리기 전에 무엇이 떠 있었고 api·web 이 무슨 말을 남겼는지 찍는다 — CI 에서는 이것이 유일한 단서다.
  # 프로젝트 이름만으로 부른다: compose 파일·env 파일 없이도 라벨로 컨테이너·볼륨·네트워크를 찾으므로
  # release.env 가 아직 없을 때(deploy.sh 전에 죽음)도 된다.
  if [ "$status" -ne 0 ]; then
    step "실패 — 컨테이너 상태·로그 (프로젝트 $PROJECT)"
    docker compose -p "$PROJECT" ps -a 2>/dev/null || true
    docker compose -p "$PROJECT" logs --no-color --tail 60 api 2>/dev/null || true
    docker compose -p "$PROJECT" logs --no-color --tail 30 web 2>/dev/null || true
    docker compose -p "$PROJECT" logs --no-color --tail 30 proxy 2>/dev/null || true
  fi
  step "정리 (down -v, 이미지 삭제)"
  docker rm -f "$PROJECT-load" >/dev/null 2>&1 || true
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm -f "$IMAGE" "$WEB_IMAGE" "$IMAGE-next" "$WEB_IMAGE-next" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  return $status
}
trap cleanup EXIT

command -v docker >/dev/null || fail "docker 가 없다"
docker compose version >/dev/null 2>&1 || fail "docker compose 가 없다"
[ -x "$HOME_DIR/deploy.sh" ] || fail "배포 스크립트가 없다: deploy/home/deploy.sh"

# build_image <태그> <docker build 인자...> — 진행 로그는 파일로 받고, 실패했을 때만 끝부분을 보여 준다
# (CI 에서 --quiet 로 지우면 어느 RUN 이 왜 죽었는지 알 수 없다).
build_image() {
  local tag="$1" log="$WORK/build-${1%%:*}.log"; shift
  if ! docker build --progress=plain -t "$tag" "$@" >"$log" 2>&1; then
    tail -80 "$log" >&2
    # 로그 파일은 정리(rm -rf $WORK)와 함께 사라진다 — 경로를 알려 줘도 소용없다.
    fail "이미지 빌드 실패: $tag (위는 로그 끝 80줄. 전체는 SMOKE_KEEP=1 로 다시 돌리면 임시 디렉토리의 build-*.log 에 남는다)"
  fi
}

# ── 1. jar → API 이미지 ────────────────────────────────────────────────────────
step "jar 빌드 (apps/api ./gradlew bootJar)"
# 러너에 데몬을 남기지 않도록 CI 에서만 --no-daemon.
(cd "$API_DIR" && ./gradlew --quiet --console=plain ${CI:+--no-daemon} bootJar)
[ -f "$API_DIR/build/libs/acting-api.jar" ] || fail "jar 가 없다: apps/api/build/libs/acting-api.jar"

step "API 이미지 빌드 → $IMAGE (컨텍스트 apps/api)"
build_image "$IMAGE" "$API_DIR"

step "이미지 안에 ffmpeg·ffprobe·curl·tesseract(한국어) 가 있고 non-root 로 돈다"
# ENTRYPOINT 가 java 라 --entrypoint 로 바꿔 부른다. 첫 줄만 보여 준다(head 는 pipefail 과 충돌).
image_has() {
  local cmd="$1" out; shift
  out="$(docker run --rm --entrypoint "$cmd" "$IMAGE" "$@" 2>/dev/null)" || fail "이미지 안에 $cmd 가 없다"
  printf '  %s\n' "${out%%$'\n'*}"
}
image_has ffmpeg -version
image_has ffprobe -version
image_has curl --version
# 그림 PDF 대본의 글자 인식(DocumentText)은 tesseract 가 없으면 조용히 「읽지 못함」으로 돌아간다 — 여기서 잡는다.
langs="$(docker run --rm --entrypoint tesseract "$IMAGE" --list-langs 2>/dev/null)" || fail "이미지 안에 tesseract 가 없다"
grep -qx kor <<<"$langs" || fail "이미지 안에 tesseract 한국어 데이터가 없다"
echo "  tesseract kor"
# assert_non_root <이미지> → uid 를 찍고 0 이면 fail. api·web 이미지가 같은 검사를 받는다.
assert_non_root() {
  local uid
  uid="$(docker run --rm --entrypoint id "$1" -u)"
  [ "$uid" != "0" ] || fail "$1 이 root(uid 0)로 돈다"
  echo "  uid=$uid"
}
assert_non_root "$IMAGE"

# ── 2. 웹 이미지 (컨텍스트 = 저장소 루트, 워크스페이스 lockfile 때문) ───────────
# 커밋은 아래 deploy.sh 에 넘기는 sha 와 같은 값이어야 /health 대조가 성립하므로 여기서 먼저 정한다.
COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 0123456789abcdef0123456789abcdef01234567)"

step "웹 이미지 빌드 → $WEB_IMAGE (컨텍스트 $ROOT, build-arg 는 테스트 값)"
# build-arg 를 받아 빌드가 통과하는지를 본다. 값이 번들까지 갔는지는 아래 6 단계에서 사이트 URL 하나로
# 확인한다(랜딩 HTML 의 canonical·og:url 에 새겨진다). 호스트는 전부 .invalid — DSN 으로 에러가 나도
# 어디로도 가지 않는다. SENTRY_AUTH_TOKEN 시크릿은 일부러 안 넘긴다: 없을 때 소스맵 업로드를 건너뛰고
# 통과해야 한다.
SITE_URL=https://smoke.acttub.invalid
build_image "$WEB_IMAGE" -f "$ROOT/apps/web/Dockerfile" \
  --build-arg API_ORIGIN=http://api:8080 \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  --build-arg NEXT_PUBLIC_SENTRY_DSN=https://smoke@sentry.invalid/1 \
  --build-arg NEXT_PUBLIC_SENTRY_ENV=smoke \
  --build-arg NEXT_PUBLIC_POSTHOG_KEY=smoke-posthog-key \
  --build-arg NEXT_PUBLIC_APP_COMMIT="$COMMIT" \
  "$ROOT"

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

# ── 3. 프로젝트 디렉토리 흉내: compose.yml 사본 + 테스트용 .env ─────────────────
# 가짜 값으로 충분해야 한다 — 기동에 실제 외부 호출이 필요하면 이 단계에서 드러난다.
# 웹은 런타임 env 를 받지 않는다(설정은 이미지에 굳어 있다). 그래서 .env 에 웹 몫 키가 없다.
# TUNNEL_TOKEN 은 compose 가 파일 전체를 치환할 때 요구하므로 넣되, COMPOSE_PROFILES 가 없어
# cloudflared(edge)·backup 은 뜨지 않는다 — 그 값은 어디로도 가지 않는다.
# release.env 는 여기서 만들지 않는다 — deploy.sh 가 쓰는 것이 이 스모크의 판정 대상이다.
cp "$HOME_DIR/compose.yml" "$WORK/compose.yml"
mkdir "$WORK/proxy" && cp "$HOME_DIR/proxy/nginx.conf" "$WORK/proxy/nginx.conf"
cat > "$WORK/.env" <<ENV
COMPOSE_PROJECT_NAME=$PROJECT
POSTGRES_PASSWORD=smoke-pw
JWT_SECRET=smoke-jwt-secret
ACCOUNT_IDENTITY_HASH_KEY=smoke-identity-hash-key
ACCOUNT_TOKEN_ENCRYPTION_KEY=smoke-token-encryption-key
SITE_URL=$SITE_URL
ADMIN_OPS_TOKEN=smoke-admin-token
GEMINI_API_KEY=smoke-gemini-key
OPENAI_API_KEY=smoke-openai-key
S3_BUCKET=smoke-bucket
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=SMOKEACCESSKEY
AWS_SECRET_ACCESS_KEY=smoke-secret-key
TUNNEL_TOKEN=smoke-tunnel-token-unused
ENV

# deploy <sha> [deploy.sh env...] — 서버에서 부르는 그대로. 이미지는 로컬 태그라 pull 정책만 missing.
deploy() {
  local sha="$1"; shift
  deploy_images "$sha" "$IMAGE" "$WEB_IMAGE" "$@"
}
# deploy_images <sha> <api 이미지> <web 이미지> [deploy.sh env...] — 11 단계부터 태그를 바꿔 web 도 새 판으로 만든다.
deploy_images() {
  local sha="$1" api="$2" web="$3"; shift 3
  (cd "$WORK" && env DEPLOY_PULL_POLICY=missing "$@" "$HOME_DIR/deploy.sh" "$sha" "$api" "$web")
}

# ── 4. deploy.sh 로 첫 배포 (빈 볼륨) ──────────────────────────────────────────
step "deploy.sh $COMMIT (빈 볼륨) → release.env·pull·up·healthy 대기·commit 대조"
deploy "$COMMIT" || fail "deploy.sh 가 첫 배포에서 실패했다"
[ -f "$WORK/release.env" ] || fail "deploy.sh 가 release.env 를 쓰지 않았다"
grep -q "^RENDER_GIT_COMMIT=$COMMIT\$" "$WORK/release.env" || fail "release.env 의 RENDER_GIT_COMMIT 이 $COMMIT 이 아니다"
grep -q "^API_IMAGE=$IMAGE\$" "$WORK/release.env" || fail "release.env 의 API_IMAGE 가 $IMAGE 가 아니다"
grep -q "^WEB_IMAGE=$WEB_IMAGE\$" "$WORK/release.env" || fail "release.env 의 WEB_IMAGE 가 $WEB_IMAGE 가 아니다"
compose ps

step "프로필 서비스(cloudflared·backup)가 뜨지 않았고 호스트 포트를 publish 하지 않는다"
running="$(compose ps --services --status running | sort | tr '\n' ' ')"
[ "$running" = "api db proxy web " ] || fail "도는 서비스가 api·db·proxy·web 이 아니다: $running"
# EXPOSE 만 된 포트는 "8080/tcp", 호스트에 묶인 포트는 "0.0.0.0:8080->8080/tcp" 로 나온다.
published="$(compose ps --format '{{.Name}} {{.Ports}}' | grep -- '->' || true)"
[ -z "$published" ] || fail "호스트에 publish 된 포트가 있다: $published"
compose ps --format '  {{.Name}} {{.Ports}}'

# ── 5. /health (api 컨테이너 안에서) ───────────────────────────────────────────
step "api 컨테이너 안에서 GET /health"
body="$(compose exec -T api curl -sS -w '\n%{http_code}' http://localhost:8080/health)"
code="${body##*$'\n'}"
json="${body%$'\n'*}"
echo "  $code $json"
[ "$code" = "200" ] || fail "/health 가 $code 를 줬다"
# grep -q/-m1 은 일찍 종료한다. 큰 본문·로그를 printf 로 파이프에 쓰면 SIGPIPE 가 나서
# pipefail 이 정상 응답도 실패로 읽으므로, 변수는 <<< 로 직접 전달한다.
grep -q '"status":"ok"' <<< "$json" || fail "status 가 ok 가 아니다"
grep -Eq '"services":\["[a-z]+"' <<< "$json" || fail "services 목록이 비었다"
grep -q "\"commit\":\"${COMMIT:0:7}\"" <<< "$json" || fail "commit 이 ${COMMIT:0:7} 이 아니다"

# ── 6. 웹 경유 (web 컨테이너 안에서) ───────────────────────────────────────────
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
grep -qi '<html' <<< "$web_body" || fail "/ 의 본문이 HTML 이 아니다"
grep -q "$SITE_URL" <<< "$web_body" \
  || fail "/ 의 HTML 에 NEXT_PUBLIC_SITE_URL($SITE_URL)이 없다 — build-arg 가 번들에 들어가지 않았다"

step "web 컨테이너 안에서 GET /health — rewrites 가 api:8080(front 망의 proxy)으로 넘겨 본문이 api 의 것과 같다"
expect_web /health "rewrites"
[ "$web_body" = "$json" ] || fail "web 경유 /health 본문이 api 의 것과 다르다: $web_body"

# proxy_health → 터널이 보는 길(proxy:3000 → web → proxy:8080 → api)의 /health 본문. 런타임 nginx 이미지에는 wget 만 있다.
proxy_health() { compose exec -T proxy wget -q -O - http://127.0.0.1:3000/health; }
proxy_commit() { sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' <<< "$(proxy_health)"; }
step "proxy 안에서 GET :3000/health — 터널이 보는 길의 본문이 api 의 것과 같다"
body="$(proxy_health)" || fail "proxy 경유 /health 를 부르지 못했다"
[ "$body" = "$json" ] || fail "proxy 경유 /health 본문이 api 의 것과 다르다: $body"
echo "  $body"

# PG 심사 기능은 설정하지 않으면 닫혀 있어야 한다. 두 프록시 모두 API의 JSON 404를 주고,
# 콜백 형태의 쿼리는 프록시·앱 로그에 남기지 않는다. 표식은 실제 키가 아닌 회귀 테스트 문자열이다.
step "PG 심사 기본 비활성·API 직결·콜백 쿼리 로그 비노출"
pg_probe="pg-review-query-probe-$PROJECT"
for pg_port in 3000 8080; do
  compose exec -T web node --input-type=module -e '
    const [port, marker] = process.argv.slice(1);
    const r = await fetch(`http://api:${port}/v2/pg-review/config?authKey=${marker}`, { redirect: "manual" });
    if (r.status !== 404) throw new Error(`PG review must be closed: ${r.status}`);
    await r.json();
  ' -- "$pg_port" "$pg_probe" || fail "PG 심사 경로가 기본 비활성 API로 연결되지 않는다"
done
pg_logs="$(compose logs --no-color proxy api web)"
if grep -Fq "$pg_probe" <<< "$pg_logs"; then
  fail "PG 심사 콜백 쿼리가 컨테이너 로그에 남았다"
fi
echo "  기본 비활성 · 두 API 경로 JSON 404 · 쿼리 표식 비노출"

# 망 별칭(compose.yml 의 proxy 주석): 진짜 web·api 가 같은 망에 끼어들면 이름이 둘로 풀려 proxy 를 건너뛴다 — 무중단이 조용히
# 깨지는 자리라 망마다 하나로만 풀리는지 본다. edge 망(터널 자리)은 cloudflared 가 없어 웹 이미지의 getent 로 묻는다.
step "망 별칭: web 안의 api 와 edge 망의 web 이 proxy 하나로만 풀린다"
proxy_id="$(compose ps -q proxy)"
proxy_ip() { docker inspect -f "{{(index .NetworkSettings.Networks \"${PROJECT}_$1\").IPAddress}}" "$proxy_id"; }
resolved_from_web="$(compose exec -T web getent ahostsv4 api | awk '{print $1}' | sort -u | tr '\n' ' ')"
[ "$resolved_from_web" = "$(proxy_ip front) " ] || fail "web 안에서 api 가 proxy($(proxy_ip front)) 하나로 풀리지 않는다: $resolved_from_web"
resolved_from_edge="$(docker run --rm --network "${PROJECT}_edge" --entrypoint getent "$WEB_IMAGE" ahostsv4 web | awk '{print $1}' | sort -u | tr '\n' ' ')"
[ "$resolved_from_edge" = "$(proxy_ip edge) " ] || fail "edge 망에서 web 이 proxy($(proxy_ip edge)) 하나로 풀리지 않는다: $resolved_from_edge"
echo "  web → api = ${resolved_from_web}· edge → web = ${resolved_from_edge}"

step "prebuild 산출물이 서빙된다 — /ort/*, /fonts/pretendard/*"
expect_web /ort/ort-wasm-simd-threaded.wasm "onnxruntime wasm"
expect_web "/fonts/pretendard/$font_ver/pretendard.css" "Pretendard"
grep -q '@font-face' <<< "$web_body" || fail "pretendard.css 에 @font-face 가 없다"

# ── 7. Flyway: V1 부터 최신까지 ────────────────────────────────────────────────
step "Flyway 로그: V1 부터 db/migration 의 최대 버전까지 적용"
latest="$(ls "$MIGRATIONS" | grep -oE '^V[0-9]+' | tr -d V | sort -n | tail -1)"
logs="$(compose logs --no-color api)"
printf '%s\n' "$logs" | grep -E 'Migrating schema "public" to version "1 ' >/dev/null \
  || fail "V1 적용 로그가 없다"
now_at="$(printf '%s\n' "$logs" | grep -oE 'now at version v[0-9]+' | tail -1 | grep -oE '[0-9]+$' || true)"
[ "$now_at" = "$latest" ] || fail "Flyway 가 v$latest 가 아니라 v${now_at:-?} 에서 멈췄다"
printf '%s\n' "$logs" | grep -E 'Migrating schema|Successfully applied' | sed 's/^/  /'

# ── 8. 필수 env 누락 → compose 가 거부 ──────────────────────────────────────────
# release.env 가 있어야 image: 치환이 통과해 ADMIN_OPS_TOKEN 하나만 걸린다. 그래서 첫 배포 뒤에 본다.
step "필수 env(ADMIN_OPS_TOKEN)를 빼면 compose 가 이름을 찍고 거부한다"
grep -v '^ADMIN_OPS_TOKEN=' "$WORK/.env" > "$WORK/.env.missing"
if out="$(compose_with "$WORK/.env.missing" config --quiet 2>&1)"; then
  fail "ADMIN_OPS_TOKEN 없이도 compose config 가 통과했다"
fi
grep -q 'ADMIN_OPS_TOKEN' <<< "$out" || fail "거부 메시지에 ADMIN_OPS_TOKEN 이 없다: $out"
printf '  %s\n' "${out%%$'\n'*}"

# ── 9. 같은 sha 재실행 → 초록·무변경 (멱등) ────────────────────────────────────
step "deploy.sh $COMMIT 재실행 → 초록이고 컨테이너 ID 가 그대로다"
ids_before="$(compose ps -q | sort | tr '\n' ' ')"
deploy "$COMMIT" || fail "같은 sha 재실행이 실패했다"
ids_after="$(compose ps -q | sort | tr '\n' ' ')"
[ "$ids_before" = "$ids_after" ] || fail "같은 sha 인데 컨테이너가 바뀌었다: $ids_before → $ids_after"
echo "  컨테이너 $(printf '%s' "$ids_after" | wc -w | tr -d ' ')개 그대로"

# ── 10. restore-db.sh 왕복 — 덤프 → DB 변경 → 복원 → 덤프 시점으로 돌아오고 Flyway 는 "up to date" ─────────
# dev 이전·백업 복원 연습·운영 컷오버가 같은 스크립트를 쓴다. 반증하는 것: 실패하면(깨진 덤프·행 수 불일치) 원래 DB 가
# 그대로 남고 api 가 다시 healthy 다, 성공하면 DB 가 덤프와 같고 컨테이너는 재생성되지 않는다.
if [ "${SMOKE_RESTORE:-true}" = true ]; then
  RESTORE_SH="$HOME_DIR/restore-db.sh"
  # db_psql <psql 인자...> — db 컨테이너 안의 psql. 사용자·DB 이름은 테스트용 .env 가 비워 둔 compose 기본값(acttub).
  db_psql() { compose exec -T db psql -X -v ON_ERROR_STOP=1 -U acttub -d acttub "$@"; }
  step "restore-db.sh: 지금 DB 를 pg_dump -Fc 로 뜨고 --counts 로 행 수를 적어 둔다"
  [ -x "$RESTORE_SH" ] || fail "복원 스크립트가 없다: deploy/home/restore-db.sh"
  compose exec -T db pg_dump -Fc -U acttub -d acttub > "$WORK/smoke.dump" || fail "db 컨테이너에서 pg_dump 가 실패했다"
  (cd "$WORK" && "$RESTORE_SH" --counts) > "$WORK/counts-before.tsv" || fail "restore-db.sh --counts 가 실패했다"
  (cd "$WORK" && "$RESTORE_SH" --manifest) > "$WORK/manifest-before.tsv" || fail "restore-db.sh --manifest 가 실패했다"
  # 이력 행 수 = db/migration 의 버전 파일 수. 상수로 적으면 V5 가 들어오는 날 여기서 빨강이 된다. 최대 버전 번호와는 다를 수
  # 있다 — 다른 브랜치가 앞 번호를 잡아 둔 동안(예: V59 를 비워 두고 V60 을 먼저 올린 PR) 번호에 빈칸이 생긴다.
  applied="$(ls "$MIGRATIONS" | grep -cE '^V[0-9]+__')"
  grep -q "$(printf '^flyway_schema_history\t%s$' "$applied")" "$WORK/counts-before.tsv" \
    || fail "--counts 에 flyway_schema_history $applied 가 없다: $(tr '\n' ' ' < "$WORK/counts-before.tsv")"
  echo "  $(wc -c < "$WORK/smoke.dump" | tr -d ' ')B, 테이블 $(wc -l < "$WORK/counts-before.tsv" | tr -d ' ')개"

  step "DB 를 바꾼 뒤(smoke_marker) 깨진 덤프로 복원 → exit≠0, 바꾼 것이 그대로, api healthy"
  db_psql -q -c 'create table smoke_marker (id int); insert into smoke_marker values (1)' || fail "smoke_marker 를 만들지 못했다"
  printf 'not a dump\n' > "$WORK/broken.dump"
  if out="$(cd "$WORK" && "$RESTORE_SH" "$WORK/broken.dump" 2>&1)"; then
    printf '%s\n' "$out"; fail "깨진 덤프인데 restore-db.sh 가 초록으로 끝났다"
  fi
  grep -q '✗.*pg_restore' <<< "$out" || { printf '%s\n' "$out"; fail "pg_restore 실패가 아닌 다른 이유로 실패했다"; }
  marker="$(db_psql -Atc 'select count(*) from smoke_marker')" || fail "smoke_marker 를 세지 못했다"
  [ "$marker" = "1" ] || fail "복원이 실패했는데 원래 DB 가 남아 있지 않다(smoke_marker=$marker)"
  api_health="$(compose ps --format '{{.Service}} {{.Health}}' api)"
  [ "$api_health" = "api healthy" ] || fail "실패 뒤 api 가 healthy 가 아니다: $api_health"
  printf '  %s\n' "$(grep -m1 '✗' <<< "$out")"

  step "제대로 된 덤프 + --expect 행 수·--expect-manifest → 초록, smoke_marker 가 사라지고 Flyway 는 up to date, 컨테이너 ID 그대로"
  ids_before="$(compose ps -q | sort | tr '\n' ' ')"
  out="$(cd "$WORK" && "$RESTORE_SH" "$WORK/smoke.dump" --expect "$WORK/counts-before.tsv" --expect-manifest "$WORK/manifest-before.tsv" 2>&1)" || { printf '%s\n' "$out"; fail "restore-db.sh 가 실패했다"; }
  grep -q 'up to date' <<< "$out" || { printf '%s\n' "$out"; fail "restore-db.sh 출력에 Flyway up to date 판정이 없다"; }
  ids_after="$(compose ps -q | sort | tr '\n' ' ')"
  [ "$ids_before" = "$ids_after" ] || fail "복원이 컨테이너를 재생성했다: $ids_before → $ids_after"
  marker_gone="$(db_psql -Atc "select to_regclass('public.smoke_marker') is null")" || fail "smoke_marker 유무를 묻지 못했다"
  [ "$marker_gone" = "t" ] || fail "복원 뒤에도 smoke_marker 가 남아 있다 — 덤프 상태로 돌아가지 않았다"
  (cd "$WORK" && "$RESTORE_SH" --counts) | diff "$WORK/counts-before.tsv" - >/dev/null || fail "복원 뒤 행 수가 덤프 시점과 다르다"
  (cd "$WORK" && "$RESTORE_SH" --manifest) | diff "$WORK/manifest-before.tsv" - >/dev/null || fail "복원 뒤 행 내용·sequence·스키마가 덤프 시점과 다르다"
  expect_web /health "복원 뒤 rewrites"
  [ "$web_body" = "$json" ] || fail "복원 뒤 web 경유 /health 본문이 처음과 다르다: $web_body"
  printf '%s\n' "$out" | grep -E 'up to date|✔' | sed 's/^/  /'

  step "--expect 의 행 수가 다르면 exit≠0 이고 DB 는 그대로"
  sed $'s/^users\t[0-9]*$/users\t999/' "$WORK/counts-before.tsv" > "$WORK/counts-wrong.tsv"
  if out="$(cd "$WORK" && "$RESTORE_SH" "$WORK/smoke.dump" --expect "$WORK/counts-wrong.tsv" 2>&1)"; then
    printf '%s\n' "$out"; fail "행 수가 다른데 restore-db.sh 가 초록으로 끝났다"
  fi
  grep -q '✗.*행 수' <<< "$out" || { printf '%s\n' "$out"; fail "행 수 불일치가 아닌 다른 이유로 실패했다"; }
  (cd "$WORK" && "$RESTORE_SH" --counts) | diff "$WORK/counts-before.tsv" - >/dev/null || fail "실패한 복원이 DB 를 바꿨다"
  api_health="$(compose ps --format '{{.Service}} {{.Health}}' api)"
  [ "$api_health" = "api healthy" ] || fail "실패 뒤 api 가 healthy 가 아니다: $api_health"
  printf '  %s\n' "$(grep -m1 '✗' <<< "$out")"
else
  step "restore-db.sh 왕복 건너뜀 (SMOKE_RESTORE=${SMOKE_RESTORE})"
fi

# ── 11. 무중단 재배포 (SOMA-700) ───────────────────────────────────────────────
# 터널 자리(edge 망의 web = proxy)에서 keep-alive 부하를 건 채 다른 sha 로 배포한다. 이미지는 같고 태그만 바꿔 api·web 둘 다
# 새 판이 된다. 실패한 요청이 하나도 없어야 하고, 옛 판·새 판이 둘 다 응답했어야(전환이 부하 한가운데서 일어남) 한다.
# 부하는 초당 수십 건으로 둔다. proxy 는 요청마다 연결을 새로 맺어(keepalive_timeout 0) 요청 하나가 연결 넷을 만들고, 닫힌
# 연결은 커널 연결 추적표에 120초 남는다 — 초당 수백 건이면 표(Docker Desktop 65,536)가 차 DNS 패킷까지 버려진다(실측).
# 기존 방식(제자리 재생성)의 끊김은 이 부하로도 수천 건으로 드러난다.
NEXT_COMMIT="$(printf '%s' "$COMMIT" | tr '0-9a-f' '1-9a-f0')"
IMAGE_NEXT="$IMAGE-next" WEB_IMAGE_NEXT="$WEB_IMAGE-next"
docker tag "$IMAGE" "$IMAGE_NEXT"
docker tag "$WEB_IMAGE" "$WEB_IMAGE_NEXT"
LOAD_JS="$(cat <<'JS'
const http = require("node:http");
const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
const counts = {}, errors = [];
let stop = false;
process.on("SIGTERM", () => { stop = true; });
const get = () => new Promise((resolve) => {
  const req = http.get("http://web:3000/health", { agent }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      let commit = "";
      try { commit = JSON.parse(body).commit ?? ""; } catch {}
      resolve(res.statusCode === 200 && commit ? commit : `${res.statusCode} ${body.slice(0, 80)}`);
    });
  });
  req.on("error", (e) => resolve(`ERR ${e.code}`));
  req.setTimeout(30000, () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
});
const loop = async () => {
  while (!stop) {
    const out = await get();
    if (/^[0-9a-f]{7}$/.test(out)) counts[out] = (counts[out] ?? 0) + 1; else errors.push(out);
    await new Promise((r) => setTimeout(r, 50));
  }
};
Promise.all(Array.from({ length: 4 }, loop)).then(() => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + errors.length;
  console.log(`total=${total} failed=${errors.length} ${JSON.stringify({ counts, errors: errors.slice(0, 10) })}`);
  process.exit(0);
});
JS
)"
step "deploy.sh ${NEXT_COMMIT:0:7} (다른 sha·태그) — 터널 자리 부하 중 옆에 띄워 넘기기: 실패 0, 옛·새 판 모두 응답"
api_before="$(compose ps -q api)" web_before="$(compose ps -q web)" proxy_before="$(compose ps -q proxy)"
docker run -d --name "$PROJECT-load" --network "${PROJECT}_edge" --entrypoint node "$WEB_IMAGE" -e "$LOAD_JS" >/dev/null
sleep 2
deploy_images "$NEXT_COMMIT" "$IMAGE_NEXT" "$WEB_IMAGE_NEXT" || fail "다른 sha 재배포가 실패했다"
docker stop -t 30 "$PROJECT-load" >/dev/null
load="$(docker logs "$PROJECT-load" 2>&1)"
docker rm -f "$PROJECT-load" >/dev/null
echo "  $load"
total="$(sed -n 's/^total=\([0-9]*\) .*/\1/p' <<< "$load")"
failed="$(sed -n 's/^total=[0-9]* failed=\([0-9]*\) .*/\1/p' <<< "$load")"
[ "${failed:-x}" = 0 ] || fail "재배포 중 터널 자리의 요청 ${failed:-?}건이 실패했다"
[ "${total:-0}" -ge 100 ] || fail "부하가 너무 적다(${total:-0}건) — 전환을 시험했다고 볼 수 없다"
grep -q "\"${COMMIT:0:7}\":[1-9]" <<< "$load" || fail "옛 판(${COMMIT:0:7})의 응답이 없다 — 부하가 배포 전에 시작되지 않았다"
grep -q "\"${NEXT_COMMIT:0:7}\":[1-9]" <<< "$load" || fail "새 판(${NEXT_COMMIT:0:7})의 응답이 없다 — 부하가 전환 전에 끝났다"
[ "$(proxy_commit)" = "${NEXT_COMMIT:0:7}" ] || fail "proxy 경유 /health 가 새 판 commit 을 답하지 않는다"
api_after="$(compose ps -q api)" web_after="$(compose ps -q web)"
[ "$(printf '%s\n' "$api_after" | grep -c .)" = 1 ] && [ "$(printf '%s\n' "$web_after" | grep -c .)" = 1 ] \
  || fail "배포 뒤 api·web 컨테이너가 하나씩이 아니다: api=[$api_after] web=[$web_after]"
[ "$api_after" != "$api_before" ] && [ "$web_after" != "$web_before" ] || fail "api·web 이 새 컨테이너로 바뀌지 않았다"
[ "$(compose ps -q proxy)" = "$proxy_before" ] || fail "proxy 가 다시 만들어졌다 — reload 만 해야 한다"
[ ! -e "$WORK/release.env.prev" ] || fail "성공한 배포가 release.env.prev 를 남겼다"

# 새 api 는 이미 마이그레이션된 DB(10 단계를 돌렸으면 복원한 DB) 위에서 떴다 — 실제 재배포와 같다.
step "새 api — Flyway 는 up to date 이고 새로 적용한 것이 없다"
logs="$(compose logs --no-color api)"
grep -q 'is up to date' <<< "$logs" || fail "새 api 의 Flyway 로그에 'up to date' 가 없다"
! grep -q 'Successfully applied' <<< "$logs" || fail "새 api 가 이미 마이그레이션된 DB 에 마이그레이션을 새로 적용했다"
printf '%s\n' "$logs" | grep -E 'Current version of schema|is up to date' | tail -2 | sed 's/^/  /'

# ── 12. 새 판이 healthy 가 못 되면 옛 판을 그대로 둔다 ──────────────────────────
# 대기 상한을 api 기동보다 짧게 줘 크래시루프·느린 기동을 흉내 낸다.
THIRD_COMMIT="$(printf '%s' "$COMMIT" | tr '0-9a-f' '2-9a-f01')"
step "deploy.sh ${THIRD_COMMIT:0:7} + DEPLOY_WAIT_SECONDS=5 — 새 api 가 healthy 가 못 되면 exit≠0, 옛 판이 그대로"
ids_before="$(compose ps -aq | sort | tr '\n' ' ')"
cp "$WORK/release.env" "$WORK/release.env.before"
if out="$(deploy_images "$THIRD_COMMIT" "$IMAGE_NEXT" "$WEB_IMAGE_NEXT" DEPLOY_WAIT_SECONDS=5 2>&1)"; then
  printf '%s\n' "$out"; fail "새 api 가 5초 안에 healthy 일 수 없는데 deploy.sh 가 초록으로 끝났다"
fi
grep -q '✗.*healthy 가 되지 않았다' <<< "$out" || { printf '%s\n' "$out"; fail "healthy 시간 초과가 아닌 다른 이유로 실패했다"; }
[ "$(compose ps -aq | sort | tr '\n' ' ')" = "$ids_before" ] || fail "실패한 배포가 컨테이너를 바꿨다(새 컨테이너가 남았거나 옛 것이 사라짐)"
cmp -s "$WORK/release.env.before" "$WORK/release.env" || fail "실패한 배포가 release.env 를 되돌리지 않았다"
[ "$(proxy_commit)" = "${NEXT_COMMIT:0:7}" ] || fail "실패한 배포 뒤 옛 판(${NEXT_COMMIT:0:7})이 응답하지 않는다"
printf '  %s\n' "$(grep -m1 '✗' <<< "$out")"

# ── 13. 새 판이 다른 commit 을 답하면 넘긴 것을 되돌린다 ─────────────────────────
# 옛 컨테이너가 살아남은 채 초록이 되는 일의 재현이기도 하다. HealthController 는 Spring 프로퍼티 ${RENDER_GIT_COMMIT} 을
# 읽으므로 사람이 관리하는 .env 의 JAVA_TOOL_OPTIONS 로 시스템 프로퍼티를 주면 release.env 의 env 값을 이긴다 →
# 새 api 는 healthy 인데 commit 이 다르다. .env 가 바뀌어 api 만 새 판이 된다.
step "deploy.sh: 새 api 가 다른 commit 을 답하면 healthy 여도 exit≠0 — proxy 는 옛 판으로 돌아간다"
printf 'JAVA_TOOL_OPTIONS=-DRENDER_GIT_COMMIT=0000000stale\n' >> "$WORK/.env"
ids_before="$(compose ps -aq | sort | tr '\n' ' ')"
if out="$(deploy_images "$NEXT_COMMIT" "$IMAGE_NEXT" "$WEB_IMAGE_NEXT" 2>&1)"; then
  printf '%s\n' "$out"; fail "commit 이 0000000 인데 deploy.sh 가 초록으로 끝났다"
fi
grep -q '✗.*commit.*다르다' <<< "$out" || { printf '%s\n' "$out"; fail "commit 불일치가 아닌 다른 이유로 실패했다"; }
grep -q 'proxy 를 옛 컨테이너로 되돌렸다' <<< "$out" || { printf '%s\n' "$out"; fail "proxy 를 옛 판으로 되돌렸다는 기록이 없다"; }
[ "$(compose ps -aq | sort | tr '\n' ' ')" = "$ids_before" ] || fail "되돌린 뒤 컨테이너가 배포 전과 다르다"
[ "$(proxy_commit)" = "${NEXT_COMMIT:0:7}" ] || fail "되돌린 뒤 proxy 경유 /health 가 옛 판 commit 을 답하지 않는다"
printf '  %s\n' "$(grep -m1 '✗' <<< "$out")"

step "롤백 중 긴 요청·같은 태그 재빌드 (격리 모형 앱 + 실제 nginx)"
python3 "$HOME_DIR/rollout-test.py" "$WEB_IMAGE"

printf '\n✔ 스모크 통과 — api·web 이미지·deploy.sh(첫 배포·멱등 재실행·부하 중 무중단 재배포·healthy 실패와 commit 불일치의 되돌리기)·restore-db.sh 왕복(SMOKE_RESTORE=%s)·compose(web+api+db+proxy, 망 별칭)·Flyway v1→v%s·proxy 경유 /health commit %s→%s\n' "${SMOKE_RESTORE:-true}" "$latest" "${COMMIT:0:7}" "${NEXT_COMMIT:0:7}"

if [ -n "${SMOKE_EXPORT_API_IMAGE:-}" ]; then
  docker tag "$IMAGE" "$SMOKE_EXPORT_API_IMAGE"
  docker tag "$WEB_IMAGE" "$SMOKE_EXPORT_WEB_IMAGE"
  printf '✔ 후속 검사 이미지 보존: %s · %s\n' "$SMOKE_EXPORT_API_IMAGE" "$SMOKE_EXPORT_WEB_IMAGE"
fi
