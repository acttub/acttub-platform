# CI/CD 로드맵

GitHub Actions 도입 진행 상황과 남은 할 일. 지금까지 배포는 전부 수동 SSH였고
([dev-server-deploy], [prod-server-deploy] 참고), 여기서 단계적으로 자동화한다.

## Phase 1 — PR 게이트 ✅ (2026-07-24, #36)

- [x] `.github/workflows/ci.yml`: `on: pull_request` → dev·main 대상 PR에서 검증
  - web: lint · typecheck · test · build (정적 export). **build를 typecheck보다 먼저** —
    `next-env.d.ts`·`.next/types`(gitignore 산출물)가 있어야 `*.png`·typedRoutes를 tsc가 해석
  - api: `pytest` + `postgres:16-alpine` service container로 `RUN_DB_TESTS=1` DB 통합까지
    (#29에서 500이 새어나간 SQL 커버리지 갭을 CI로 차단)
- [x] ruleset "Require pull requests for main and dev"에 두 잡을 **required status check**로 등록
      → 초록이어야만 머지
  - ⚠️ 함정: check context = 잡 이름 문자열 그대로. `ci.yml`에서 잡 `name:`을 바꾸면
    그 컨텍스트가 안 와서 dev·main 머지가 전부 막힌다 — 이름 변경 시 ruleset도 함께 갱신

## Phase 2 — 배포 자동화 (미착수)

지금 손으로 하는 순서(SSH → `git pull` → `uv sync` → `alembic upgrade` → `systemctl restart`,
그리고 로컬 웹 빌드 → `rsync`)를 워크플로로 고정한다.

- [ ] **웹 빌드를 CI에서** 수행(러너에 node 있음) → `apps/web/out`을 서버로 `rsync`
      (개발자 로컬 머신 상태 의존 제거, 재현성 확보)
- [ ] SSH 배포 잡: `git pull → uv sync --frozen --no-dev → alembic upgrade head → systemctl restart`
      를 **정해진 순서**로. 마이그레이션 누락·순서 실수를 코드로 방지
- [ ] 웹 rsync + restart를 잡 끝에 붙여 **동시 전환** → 동의 강제/복구 UI 분리로 인한 로그인 락아웃 방지
- [ ] dev: `push: [dev]` 자동 배포 / 운영: `workflow_dispatch` + Environment 승인(수동 게이트)
- [ ] SSH 키·서버 IP는 GitHub Secrets(Environment별)로

## Phase 3 — env 단일화 (미착수)

- [ ] dev/prod `.env` 드리프트 근절 — 2026-07-23 dev에만 있던 `APPLE_OAUTH_CLIENT_ID`로
      운영 웹 Apple 로그인만 401 났던 사고. GitHub Environments secret을 단일 소스로 삼아 배포 시 렌더링
- [ ] systemd 유닛(`acting-api.service`)을 레포로 편입 + 배포 시 `daemon-reload`
      (현재 레포 밖에 있어 drift 경고 + 리부트 리스크)
- [ ] dev/prod parity 유지: 환경별 플래그 분기 대신 동일 소스 + 의도된 차이만
      (`DEVELOPMENT_AUTH_PROVIDER`)

## 소소한 정리 (아무 때나)

- [ ] `Node.js 20 deprecated` 경고 제거: `actions/checkout@v5`·`actions/setup-node@v5`로 상향
      (현재 실패 아님, 안내만)
- [ ] (선택) path filter로 web/api 잡을 변경 경로에 따라 조건 실행 — 단, required check가
      skip되면 머지가 막힐 수 있어 도입 시 주의
