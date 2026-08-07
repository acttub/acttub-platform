# Acttub 모노레포 지침

## 프로젝트 구조

Acttub 플랫폼 모노레포. JS(pnpm)와 Python(uv)이 공존합니다.

- `apps/web`: Next.js 웹 앱. `output:'standalone'`으로 빌드해 Node 프로세스가 서빙합니다. 화면 렌더와 `/v2/*` 프록시만 담당하고, 서버 로직은 두지 않습니다.
- `apps/api`: FastAPI 백엔드(acting-api). uv 파이썬 모노레포이며 자체 AGENTS.md를 따릅니다.
- `apps/mobile`: 향후 React Native 앱 자리. 작업 시작 전까지 비워둡니다.
- `packages/*`: 공유 패키지 자리. 실제 두 번째 사용처가 생긴 뒤에만 분리합니다.
- `docs/`: 크로스커팅 문서(PRD, 아키텍처, ADR, 디자인 시스템). 앱 상세 문서는 각 앱 디렉토리에 둡니다.

## 실행·검증 명령

- 개발 루프: 터미널1 `cd apps/api && DEVELOPMENT_AUTH_PROVIDER=1 uv run uvicorn acting_api.app:create_app --factory --port 8000` + 터미널2 `pnpm dev`(:3000). dev 서버가 `/v2/*`·`/health`를 8000으로 프록시하므로 CORS가 필요 없습니다.
- 웹 검증: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`(→ `.next/standalone/`, 실제 배포 산출물)
- 배포 형태(dev·운영 공통): **Next 서버가 화면을 서빙하고 `/v2/*`·`/health`를 rewrites로 FastAPI에 넘깁니다.** 두 프로세스가 분리돼 있어 브라우저에는 오리진이 하나로 보입니다(CORS 불필요).
  - 운영 `acttub.com`(`www`는 301): CloudFront → front ALB → front svc / back ALB → back svc → RDS. 전부 private subnet → [docs/DEPLOY-VPC.md](docs/DEPLOY-VPC.md)
  - 개발 `dev.acttub.com`: EC2 한 대에 Caddy + 두 프로세스 + PostgreSQL → [docs/DEPLOY-DEV.md](docs/DEPLOY-DEV.md)
  - 배포는 `.github/workflows/deploy.yml` 하나가 담당합니다. dev는 `dev` push 시 자동(마이그레이션 포함), 운영은 Actions 탭에서 수동 실행합니다.

## 이슈 추적 (Jira 연동)

Jira 프로젝트 `SOMA`와 GitHub이 연결되어 있습니다. 브랜치·PR에 이슈 키가 있어야 상태 전이 자동화와 개발 패널 연결이 동작합니다.

- 브랜치명에 이슈 키를 포함합니다: `feat/SOMA-123-exit-review-modal`. 타입 뒤·설명 앞에 두고, **키는 대문자**여야 인식됩니다.
- PR 제목은 `SOMA-123 <한국어 요약>` 형식입니다.
- 커밋 메시지에는 키를 넣지 않습니다(아래 커밋 컨벤션을 그대로 씁니다). 머지 커밋에 브랜치명이 들어가므로 키는 자동으로 따라갑니다.
- 자동 전이: 브랜치 생성 → `In Progress`, PR 오픈 → `검토 중`, PR 머지 → `Done`. `보류 중`은 수동으로만 넣고 뺍니다.

## 커밋 컨벤션

Conventional Commits를 따르되, 요약은 한국어 평서형으로 씁니다.

- 형식: `<타입>(<스코프>): <요약>` — 예: `feat(web): 연습을 떠날 때 후기 폼을 창으로 띄운다`
- 타입: `feat` `fix` `chore` `docs` `ci` `style` `refactor` `test`. 릴리스 브랜치 머지는 `release`를 씁니다.
- 스코프: `web` `api` `mobile`. 루트 설정·크로스커팅 변경은 생략합니다.
- 요약은 마침표 없이 `~한다` 형태로 씁니다. 영어 명령형(`add`, `fix`)은 쓰지 않습니다.
- API 계약을 깨는 변경은 타입 뒤에 `!`를 붙이고, `BREAKING CHANGE:` footer에 배포 순서 주의사항을 적습니다. 배포가 fe/be 따로 도는 구조라 순서를 틀리면 한쪽이 깨집니다.
  - 예: `feat(api)!: 씬 응답에서 legacy_id를 제거한다`

## 저장소 규칙

- 패키지 매니저는 JS=pnpm, Python=uv. 다른 lockfile을 추가하지 않습니다.
- 생성물·로컬 디렉토리는 수정 금지: `node_modules/`, `.next/`, `out/`, `.venv/`, `apps/web/src/lib/api/v2-schema.d.ts`(재생성: `pnpm --filter web generate:v2-schema`).
- API 계약 변경은 한 PR에서: 백엔드 코드 → `apps/api/spec/openapi.json` 재생성 → 웹 타입 재생성 → 프론트 수정.
- diff는 작게 유지하고, 가장 좁은 범위의 명령으로 먼저 검증합니다.

## Agent skills

### 이슈 트래커

이슈 정본은 Jira 프로젝트 `SOMA`이고, 이 환경엔 Jira CLI·MCP가 없어 에이전트는 티켓 초안만 만들고 반영은 사람이 합니다. `docs/agents/issue-tracker.md` 참고.

### 트리아지 라벨

기본 5종(`needs-triage` `needs-info` `ready-for-agent` `ready-for-human` `wontfix`)을 그대로 쓰되, 부여는 사람이 Jira에서 합니다. `docs/agents/triage-labels.md` 참고.

### 도메인 문서

단일 컨텍스트 — 루트 `CONTEXT.md`(지연 생성) + 단일 파일 `docs/ADR.md`. `docs/agents/domain.md` 참고.
