# Acttub 모노레포 지침

## 프로젝트 구조

Acttub 플랫폼 모노레포. JS(pnpm)와 Python(uv)이 공존합니다.

- `apps/web`: Next.js 웹 앱. **정적 export**(`output:'export'`)로 빌드되어 백엔드가 서빙합니다.
- `apps/api`: FastAPI 백엔드(acting-api). uv 파이썬 모노레포이며 자체 AGENTS.md를 따릅니다.
- `apps/mobile`: 향후 React Native 앱 자리. 작업 시작 전까지 비워둡니다.
- `packages/*`: 공유 패키지 자리. 실제 두 번째 사용처가 생긴 뒤에만 분리합니다.
- `docs/`: 크로스커팅 문서(PRD, 아키텍처, ADR, 디자인 시스템). 앱 상세 문서는 각 앱 디렉토리에 둡니다.

## 실행·검증 명령

- 개발 루프: 터미널1 `cd apps/api && DEVELOPMENT_AUTH_PROVIDER=1 uv run uvicorn acting_api.app:create_app --factory --port 8000` + 터미널2 `pnpm dev`(:3000). dev 서버가 `/v2/*`·`/health`를 8000으로 프록시하므로 CORS가 필요 없습니다.
- 웹 검증: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`(→ `apps/web/out/`)
- 운영 형태: FastAPI 단일 프로세스가 `STATIC_DIR=<...>/apps/web/out`으로 정적 파일과 API를 같은 오리진에서 서빙합니다 (nginx·Vercel 없음).

## 저장소 규칙

- 패키지 매니저는 JS=pnpm, Python=uv. 다른 lockfile을 추가하지 않습니다.
- 생성물·로컬 디렉토리는 수정 금지: `node_modules/`, `.next/`, `out/`, `.venv/`, `apps/web/src/lib/api/v2-schema.d.ts`(재생성: `pnpm --filter web generate:v2-schema`).
- API 계약 변경은 한 PR에서: 백엔드 코드 → `apps/api/spec/openapi.json` 재생성 → 웹 타입 재생성 → 프론트 수정.
- diff는 작게 유지하고, 가장 좁은 범위의 명령으로 먼저 검증합니다.
