# acttub-platform

Acttub 플랫폼 모노레포입니다. JavaScript는 pnpm, Python은 uv로 관리합니다.

## 구조

```text
apps/
  web/      Next.js 웹 앱 (정적 export)
  api/      FastAPI 백엔드 (acting-api)
  mobile/   React Native 앱 자리
packages/   공유 패키지 자리
```

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

```bash
pnpm lint
pnpm typecheck
pnpm --filter web test
pnpm build
```

## 운영

`pnpm build`가 생성한 `apps/web/out/`을 FastAPI가 `STATIC_DIR`로 읽어 정적 파일과
API를 같은 오리진에서 제공합니다.
