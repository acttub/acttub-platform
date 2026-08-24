# Acttub 모노레포 지침

## 프로젝트 구조

Acttub 플랫폼 모노레포. JS(pnpm)와 Java(Gradle)로 갈립니다.

- `apps/web`: Next.js 웹 앱. `output:'standalone'`으로 빌드해 Node 프로세스가 서빙합니다. 화면 렌더와 `/v2/*` 프록시만 담당하고, 서버 로직은 두지 않습니다.
- `apps/api`: Spring Boot 백엔드(acting-api). **백엔드는 이것 하나이고 dev·운영 모두 여기가 트래픽을 받습니다.** 계약을 지키는 것은 여기 Java 테스트이며, 판정 기준은 [apps/api/CONTRACT.md](apps/api/CONTRACT.md)입니다.
- `apps/mobile`: Expo React Native 앱. npm/EAS로 자립 관리하며 pnpm 워크스페이스에서 제외됩니다(심링크가 Metro를 깨서).
- `packages/*`: 공유 패키지 자리. 실제 두 번째 사용처가 생긴 뒤에만 분리합니다.
- `docs/`: 앱을 가로지르는 문서입니다. 앱 상세 문서는 각 앱 디렉토리에 둡니다. **디자인 문서는 `docs/design/`, 배포 문서는 `docs/deploy/`에 둡니다** — 추적되는 문서는 `ADR.md`·`PRD.md`·`BRANCHING-STRATEGY.md` 셋만 `docs/` 최상위에 남습니다(디스크에 보이는 `docs/TODO.md`는 추적하지 않는 로컬 메모입니다 — `.gitignore` 참고). **제품이 무엇이고 누구를 위한 것인지**는 [docs/PRD.md](docs/PRD.md)입니다. **화면·컴포넌트를 만들 때**는 [docs/design/UI_GUIDE.md](docs/design/UI_GUIDE.md)가 Acttub 적용 규칙이고 [docs/design/Toss-DESIGN.md](docs/design/Toss-DESIGN.md)가 상세 레퍼런스입니다(ADR-012). 끝난 계획·이관 사양은 `docs/archive/`로 옮깁니다 — FastAPI→Spring Boot 이관(`SOMA-287`)의 사양과 마일스톤 기록은 `docs/archive/soma287/`에 있습니다.
- `deploy/`는 배포 스크립트입니다.

세 앱 모두 각자 CLAUDE.md를 갖고 있습니다. **그 앱을 건드리기 전에 해당 파일을 읽습니다** — 아래 내용은 앱을 가로지르는 규칙만 담습니다.

## 실행·검증 명령

- 개발 루프: 터미널1 `cd apps/api && DEVELOPMENT_AUTH_PROVIDER=1 ./gradlew bootRun`(:8080) + 터미널2 `pnpm dev`(:3000). dev 서버가 `/v2/*`·`/health`를 8080으로 프록시하므로 CORS가 필요 없습니다.
- 웹 검증 명령은 루트 `package.json` scripts에 있습니다(전부 `--filter web` 위임). 두 가지만 기억하면 됩니다 — `build`를 `typecheck`보다 **먼저** 돌려야 tsc가 통과하고(`next-env.d.ts`·`.next/types` 생성), `build` 산출물 `.next/standalone/`이 실제 배포물입니다. **`test`만 루트에 없습니다** — `pnpm --filter web test`로 돌립니다.
- PR 게이트는 `.github/workflows/ci.yml`의 잡 2개(`web`·`api`)입니다. **잡을 추가하거나 지워도 자동으로 관문이 되고 말고 하지는 않습니다** — 머지를 막는 것은 ruleset의 required status check이고, 그 목록은 레포 설정에 따로 있습니다. **context 문자열은 잡 id가 아니라 `name:` 값 전체**여야 합니다(예: `api (gradle test · Testcontainers)`). 어긋나면 영원히 pending인 관문이 생기고, **지운 잡을 required로 남겨 두면 그 관문은 영원히 오지 않습니다.** ruleset은 현재 위 두 잡으로 맞춰져 있습니다(`SOMA-403`). **로컬에서 무엇을 돌려야 CI를 통과하는지는 이 워크플로가 정본입니다** — 앱별 명령은 각 앱 CLAUDE.md에 있습니다.
- 배포 형태(dev·운영 공통): **Next 서버가 화면을 서빙하고 `/v2/*`·`/health`를 rewrites로 백엔드에 넘깁니다.** 두 프로세스가 분리돼 있어 브라우저에는 오리진이 하나로 보입니다(CORS 불필요).
  - **그 백엔드는 dev·운영 모두 Spring Boot(:8080)입니다.** 2026-08-17 운영 컷오버로 과도기가 끝났습니다(`SOMA-394`).
  - 운영 `acttub.com`(`www`는 301): CloudFront → front ALB → front svc / back ALB → back svc → RDS. 전부 private subnet → [docs/deploy/DEPLOY-VPC.md](docs/deploy/DEPLOY-VPC.md)
  - 개발 `dev.acttub.com`: EC2 한 대에 Caddy + 두 프로세스 + PostgreSQL → [docs/deploy/DEPLOY-DEV.md](docs/deploy/DEPLOY-DEV.md)
  - 배포는 `.github/workflows/deploy.yml` 하나가 담당합니다. **브랜치가 곧 환경입니다** — `dev` push는 dev로, `main` push는 운영으로 자동 배포되고 마이그레이션도 양쪽 다 자동으로 돕니다. Actions 탭의 수동 실행은 재배포·부분 배포(fe/be-java)용으로 남아 있습니다.
  - **배포 아티팩트는 jar 하나뿐입니다** — **스키마 정본이 Flyway라([apps/api/CONTRACT.md](apps/api/CONTRACT.md) §5-5) 마이그레이션이 jar 기동의 일부**입니다. 스키마를 바꾸려면 `apps/api/src/main/resources/db/migration/`에 **거기 있는 가장 큰 번호 다음**으로 새 파일을 만듭니다. **`V1__baseline.sql`은 동결입니다** — 고치면 dev·운영은 멀쩡하고 신규 환경만 죽습니다.
  - **`main` 머지가 곧 운영 릴리스입니다.** 스키마 변경은 먼저 넓히고(마이그레이션 머지) 코드는 나중에 좁히는 순서로 나눠서 올립니다. 한 PR에 "컬럼 삭제 + 그 컬럼 안 쓰는 코드"를 같이 넣으면 배포 중간 상태에서 깨집니다.

## 브랜치·릴리스 전략

정본은 [docs/BRANCHING-STRATEGY.md](docs/BRANCHING-STRATEGY.md)입니다.

- 작업 브랜치는 `dev`에서 시작해 Squash merge하고, 일반 릴리스는 검증된 `dev` 전체를 `main`에 Merge commit으로 합칩니다. 선택한 커밋만 `main` 기반 브랜치에 cherry-pick하지 않습니다.
- `release/*`는 QA 중에도 다음 개발을 `dev`에 계속 합쳐야 할 때만 `dev`에서 만들며, `main`과 `dev` 양쪽에 Merge commit으로 반영합니다.
- `hotfix/*`는 반드시 운영 상태인 `main`에서 만들고, 운영 배포 직후 `main`을 `dev`와 열려 있는 `release/*`에 역병합합니다.
- **`main`에서 revert로 롤백했다면 즉시 `main`을 `dev`에 역병합합니다.** 빠뜨리면 그 변경이 `dev`에는 살아 있는 채로 운영에서만 조용히 사라지고, 다음 릴리스에서도 되살아나지 않습니다(`SOMA-402` — 조용한 삭제 3건).
- `main`, `dev`에는 직접 push하지 않습니다. `main`에 합치는 순간 운영 배포가 시작되므로 릴리스 PR에서 배포 호환성과 롤백 지점을 먼저 확인합니다.
- **`main` 대상 PR은 ruleset이 merge commit만 허용합니다** — hotfix도 예외가 아닙니다. 커밋 하나로 남기려면 PR을 열기 전에 로컬에서 정리합니다.

## 이슈 추적 (Jira 연동)

Jira 프로젝트 `SOMA`와 GitHub이 연결되어 있습니다. 작업·hotfix 브랜치와 PR에 이슈 키가 있어야 상태 전이 자동화와 개발 패널 연결이 동작합니다. 여러 이슈를 묶는 `release/*`와 릴리스 PR은 예외이며, 포함한 이슈 키를 PR 본문에 나열합니다.

- 브랜치명에 이슈 키를 포함합니다: `feat/SOMA-123-exit-review-modal`. 타입 뒤·설명 앞에 두고, **키는 대문자**여야 인식됩니다.
- 작업·hotfix PR 제목은 `SOMA-123 <한국어 요약>` 형식입니다. 릴리스 PR은 `release: YYYY-MM-DD <요약>` 형식을 사용합니다.
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

- 패키지 매니저는 JS=pnpm, Java=Gradle wrapper. 다른 lockfile을 추가하지 않습니다.
- 생성물·로컬 디렉토리는 수정 금지: `node_modules/`, `.next/`, `apps/api/build/`, `apps/web/src/lib/api/v2-schema.d.ts`(재생성: `pnpm --filter web generate:v2-schema`).
- API 계약 변경은 한 PR에서: 백엔드 코드 → `apps/api/spec/openapi.json` 재생성(`cd apps/api && UPDATE_OPENAPI_SNAPSHOT=1 ./gradlew test --tests '*OpenApiSnapshotIT*'`) → 웹 타입 재생성 → 프론트 수정. **그 스냅샷은 자기 자신과 비교하므로 diff를 눈으로 봅니다** — 무엇을 바꿨든 다시 뜨면 초록입니다. 갱신 모드는 일부러 실패로 끝납니다.
- diff는 작게 유지하고, 가장 좁은 범위의 명령으로 먼저 검증합니다.

## Agent skills

### 이슈 트래커

**이슈를 찾거나 만들 때** — 정본은 Jira 프로젝트 `SOMA`이고, Atlassian 리모트 MCP(`atlassian`)로 조회·생성합니다. 상태 전이는 GitHub 연동 자동화에 맡기고 에이전트가 건드리지 않습니다. MCP 등록 절차, 발행·조회 방법, 에이전트가 넘지 않을 쓰기 경계는 `docs/agents/issue-tracker.md`에 있습니다.

### 트리아지 라벨

**이슈에 라벨을 붙일 때** — 기본 5종(`needs-triage` `needs-info` `ready-for-agent` `ready-for-human` `wontfix`)을 Jira Labels 필드에 그대로 씁니다. 스킬이 말하는 트리아지 역할과의 대응표는 `docs/agents/triage-labels.md`에 있습니다.

### 도메인 문서

**도메인 용어를 정하거나 되돌리기 어려운 결정을 남길 때** — 앱이 여럿이어도 용어집은 하나입니다. 루트 [CONTEXT.md](CONTEXT.md) + 단일 파일 `docs/ADR.md`. 읽는 순서와 ADR 충돌 처리는 `docs/agents/domain.md`에 있습니다.
