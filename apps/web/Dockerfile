# acttub web 런타임 이미지(SOMA-489). 멀티스테이지 — pnpm 설치 → prebuild(ort wasm·Pretendard 복사) →
# next build(standalone) → 런타임 스테이지에는 standalone·.next/static·public 만 담는다.
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg API_ORIGIN=http://api:8080 \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://dev.acttub.com \
#     --build-arg NEXT_PUBLIC_SENTRY_DSN=... --build-arg NEXT_PUBLIC_SENTRY_ENV=dev \
#     --build-arg NEXT_PUBLIC_AMPLITUDE_API_KEY=... --build-arg NEXT_PUBLIC_APP_COMMIT=<sha> \
#     --build-arg SENTRY_ORG=... --build-arg SENTRY_PROJECT=... \
#     --secret id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN \
#     -t acttub-web:local .                                  # 빌드 컨텍스트 = 저장소 루트
#
# 컨텍스트가 루트인 이유: pnpm 워크스페이스라 lockfile(pnpm-lock.yaml)이 루트에 있고 apps/web 만으로는
# --frozen-lockfile 설치가 안 된다. 컨텍스트에서 빠지는 것은 루트 .dockerignore 가 정한다.
#
# ⚠ 웹 설정은 전부 빌드 시점에 굳는다(apps/web/CLAUDE.md, next.config.ts). API_ORIGIN 은 rewrites 로
# routes-manifest 에, NEXT_PUBLIC_* 는 브라우저 번들에 새겨져 런타임 env 로는 바뀌지 않는다. 그래서
# 환경별로 이미지를 따로 굽는다(web:dev-<sha>·web:prod-<sha>). API 주소만은 양쪽 다 compose 서비스
# 이름 http://api:8080 이다. build-arg 로 받는 값은 이미 브라우저에 내려가는 공개값뿐이라 이미지를
# 공개(GHCR)해도 된다 — SENTRY_AUTH_TOKEN 만 시크릿이고, 그건 --secret 마운트라 레이어에 남지 않는다.

# ── deps: 워크스페이스 매니페스트만으로 설치. 소스가 바뀌어도 이 레이어는 캐시된다 ──────────────
FROM node:24-bookworm-slim AS deps
# corepack 이 루트 package.json 의 packageManager(pnpm@x.y.z)를 읽어 lockfile 과 같은 pnpm 을 받는다.
# 버전을 여기 적지 않는다 — 적으면 package.json 과 둘이 되어 한쪽만 올라간다.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
# store 를 BuildKit 캐시 마운트에 두면 반복 빌드에서 패키지를 다시 받지 않는다. 마운트가 다른
# 파일시스템이라 pnpm 이 하드링크 대신 복사하는 것은 의도된 동작이다.
RUN --mount=type=cache,id=acttub-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web --store-dir /pnpm/store

# ── build: prebuild(ort wasm·Pretendard) → next build(standalone) ──────────────────────────────
FROM deps AS build
COPY apps/web apps/web
# /admissions/[id] 의 정적 경로 목록은 빌드 때 모노레포의 원본을 직접 읽는다
# (src/features/admissions/university-ids.ts → ../api/src/main/resources/admissions/notices.json).
# 웹 빌드가 apps/api 에서 읽는 유일한 파일이라 이것만 들인다(루트 .dockerignore 의 예외와 짝).
COPY apps/api/src/main/resources/admissions/notices.json apps/api/src/main/resources/admissions/
# 아래 ARG 는 이 스테이지의 RUN 에만 env 로 들어간다. 런타임 스테이지에는 남지 않는다.
ARG API_ORIGIN=http://api:8080
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENV=
ARG NEXT_PUBLIC_AMPLITUDE_API_KEY=
ARG NEXT_PUBLIC_APP_COMMIT=
# 소스맵 업로드 대상(공개값). 토큰은 아래 --mount=type=secret 으로만 들어온다.
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
# 브라우저가 API 에 직접 가게 하는 값은 비워 둔다 — 비어 있어야 상대 경로로 나가 이 서버의 rewrites 를
# 탄다(DEPLOY-VPC §4-1). 홈서버에서도 API 는 compose 네트워크 안에만 있어 브라우저가 닿지 못한다.
ENV NEXT_PUBLIC_API_BASE_URL=
# 커밋 SHA 는 비면 안 된다 — Sentry release 가 빈 문자열이 된다(sentry-shared.ts 의 ?? "unknown" 은 빈 값을
# 못 잡는다). upload-web.sh 는 git 으로 폴백했지만 이 컨텍스트에는 .git 이 없다. 다른 인자는 비어도 뜻이
# 있다(사이트 URL 은 acttub.com 기본값, DSN·Amplitude 키는 비면 계측 끔).
RUN test -n "$NEXT_PUBLIC_APP_COMMIT" \
 || { echo "build-arg NEXT_PUBLIC_APP_COMMIT 이 비어 있다 — Sentry release 이름이 된다" >&2; exit 1; }
WORKDIR /app/apps/web
# pnpm build = prebuild(scripts/prepare-public-assets.mjs) → next build --webpack. 시크릿이 없으면
# cat 이 실패해 토큰이 빈 문자열이 되고 next.config.ts 가 소스맵 업로드를 건너뛴다(로컬·CI 스모크).
RUN --mount=type=cache,id=acttub-next-cache,target=/app/apps/web/.next/cache \
    --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)" \
    pnpm build

# ── runtime: standalone + .next/static + public 만. 소스·전체 node_modules·.env 는 없다 ────────
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# standalone 은 모노레포 트리를 유지한다 — server.js 는 apps/web/ 아래, 트레이싱된 node_modules 는
# /app 에 놓이므로 트리 전체를 옮긴다(DEPLOY-VPC §4-1). .next/static 과 public 은 standalone 이 담지
# 않아 따로 넣는다 — 빠뜨리면 스타일 없는 화면이 뜬다. sharp 는 같은 리눅스에서 빌드하므로 그대로
# 둔다(맥에서 빌드해 옮기던 시절의 제외가 여기서는 필요 없다).
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# node 이미지가 만들어 둔 사용자(uid 1000). api 이미지처럼 non-root 로 돈다.
USER node
WORKDIR /app/apps/web
# 문서용이다 — 호스트에 publish 하지 않는다. 노출은 같은 네트워크의 cloudflared 가 web:3000 으로 간다.
EXPOSE 3000
CMD ["node", "server.js"]
