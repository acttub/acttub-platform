# acttub-platform

Acttub 플랫폼 모노레포입니다. JavaScript는 pnpm, Python은 uv로 관리합니다.

## 구조

```text
apps/
  web/       Next.js 웹 앱 (Next 서버 · standalone)
  api/       FastAPI 백엔드 (acting-api) — 지금의 정본
  api-java/  Spring Boot 이관 작업 중 (SOMA-287)
  mobile/    Expo React Native 앱 (npm·EAS로 자립 관리)
packages/    공유 패키지 자리
docs/        크로스커팅 문서 (PRD · 아키텍처 · ADR · 배포)
deploy/      배포 스크립트
```

`SPEC.md` · `spec/` · `tools/`는 Spring Boot 이관 기간에만 있는 사양·판정 도구이고
M6에서 폐기합니다.

## 로컬 개발

두 터미널에서 API와 웹을 각각 실행합니다.

```bash
# 터미널 1
cd apps/api
DEVELOPMENT_AUTH_PROVIDER=1 uv run uvicorn acting_api.app:create_app --factory --port 8000

# 터미널 2 (저장소 루트)
pnpm dev
```

웹 개발 서버는 `http://localhost:3000`에서 실행되며 `/v2/*`와 `/health`를
`http://127.0.0.1:8000`으로 프록시합니다.

## 검증

루트 `package.json`의 scripts를 씁니다(전부 `--filter web` 위임).

```bash
pnpm build              # typecheck 보다 먼저 — next-env.d.ts·.next/types 를 만듭니다
pnpm typecheck
pnpm lint
pnpm --filter web test  # test 만 루트에 없습니다
```

PR을 머지하려면 `.github/workflows/ci.yml`의 잡 셋(`web`·`api`·`api-java`)이 초록이어야
합니다.

## 운영

`pnpm build`가 만든 Next 서버(standalone)가 화면을 서빙하고, `/v2/*`·`/health`를
rewrites로 백엔드에 넘깁니다. 브라우저에는 오리진이 하나로 보여 CORS가 필요 없습니다.
그 백엔드는 dev·운영 모두 Spring Boot입니다(SOMA-394 운영 컷오버 완료).
배포 절차는 운영 [docs/DEPLOY-VPC.md](docs/DEPLOY-VPC.md), 개발
[docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md)를 참고하세요.
