# Acttub 모노레포 지침

## 작업 순서

1. 바꿀 앱마다 해당 `apps/<app>/CLAUDE.md`를 먼저 읽습니다. 여러 앱을 바꾸면 모두 읽습니다.
2. 아래 「조건부 정본」에서 작업과 맞는 문서를 읽습니다. 정본끼리 충돌하면 어느 범위가 왜
   다른지 드러내고, 해결하기 전까지 그 구현 결정을 보류합니다.
3. 명령·버전·디렉터리 목록은 문서의 복사본보다 실제 설정과 현재 트리를 확인합니다.
4. 가장 좁은 검증부터 실행하고, 완료 전에 `.github/workflows/ci.yml`의 해당 잡과 같은 범위를
   확인합니다. 로컬에서 무엇을 돌려야 CI를 통과하는지는 이 워크플로가 정본입니다.

## 앱 경계

| 범위 | 지켜야 할 경계 |
|---|---|
| `apps/web` | Next.js 화면과 `/v2/*`·`/health` 프록시. API·서버 로직은 `apps/api`에 둡니다. |
| `apps/api` | dev·운영이 함께 쓰는 유일한 Spring Boot 백엔드. 계약은 `apps/api/CONTRACT.md`가 판정합니다. |
| `apps/mobile` | Expo 앱. npm/EAS로 자립하며 pnpm 워크스페이스 밖에 있습니다. |
| `packages/*` | 실제 두 번째 사용처가 생긴 뒤에만 공유 패키지로 분리합니다. |

## 조건부 정본

- **제품 행동·범위**를 정할 때 → [docs/PRD.md](docs/PRD.md)와 [CONTEXT.md](CONTEXT.md)
- **화면·컴포넌트·카피**를 만들 때 → [UI_GUIDE.md](docs/design/UI_GUIDE.md), 세부 레퍼런스는
  [Toss-DESIGN.md](docs/design/Toss-DESIGN.md)
- **API·DB·마이그레이션**을 바꿀 때 → [apps/api/CONTRACT.md](apps/api/CONTRACT.md)
- **브랜치·릴리스·hotfix·revert**를 다룰 때 →
  [docs/BRANCHING-STRATEGY.md](docs/BRANCHING-STRATEGY.md). `main` 머지는 운영 배포를 시작하며
  `main`·`dev`에는 직접 push하지 않습니다.
- **CI 잡을 추가·삭제·개명**할 때 → `.github/workflows/ci.yml`과 GitHub ruleset을 함께
  확인합니다. required check의 context는 잡 id가 아니라 `name:` 전체이고 `main`·`dev`가 같은
  목록을 따로 가집니다.
- **dev·운영 배포**를 바꿀 때 → [DEPLOY-DEV.md](docs/deploy/DEPLOY-DEV.md),
  [DEPLOY-VPC.md](docs/deploy/DEPLOY-VPC.md), `.github/workflows/deploy.yml`
- **이슈를 제안·착수하거나 브랜치·PR을 연결**할 때 →
  [issue-tracker.md](docs/agents/issue-tracker.md). Jira 본문은 사람이 쓰고 에이전트는 초안만
  넘깁니다.
- **트리아지 라벨을 판단**할 때 → [triage-labels.md](docs/agents/triage-labels.md)
- **도메인 용어를 정하거나 ADR을 제안·인용·변경하고 되돌리기 어려운 결정**을 다룰 때 →
  [domain.md](docs/agents/domain.md)

## API 계약 변경

- 백엔드 코드 → `apps/api/spec/openapi.json` 재생성 → 웹 타입 재생성 → 웹 수정 순서로 한 PR에
  담고, 스키마를 자동 생성하지 않는 모바일 영향도 직접 확인합니다.
- OpenAPI 갱신은 `apps/api`에서
  `UPDATE_OPENAPI_SNAPSHOT=1 ./gradlew test --tests '*OpenApiSnapshotIT*'`로 수행합니다. 갱신 모드는
  일부러 실패하며 스냅샷이 자기 자신과 비교되므로, 생성된 diff를 눈으로 판정합니다.
- `apps/web/src/lib/api/v2-schema.d.ts`는 직접 고치지 않고
  `pnpm --filter web generate:v2-schema`로 갱신합니다.
- DB·API 축소는 **expand → compatible code → contract** 순서로 배포를 나눕니다. 한 배포에서
  소비 중인 컬럼·필드를 제거하지 않습니다.

## 저장소·문서 규칙

- JS는 pnpm, Java는 Gradle wrapper를 사용합니다. `apps/mobile`만 npm을 사용합니다. 다른
  lockfile을 추가하지 않습니다.
- 생성물과 로컬 디렉터리(`node_modules/`, `.next/`, `apps/api/build/`)는 수정 대상이 아닙니다.
- 크로스앱 문서는 `docs/`, 앱 상세 문서는 각 앱 디렉터리에 둡니다. `docs/` 최상위에는
  `ADR.md`·`PRD.md`·`BRANCHING-STRATEGY.md`만 두고, 디자인은 `docs/design/`, 배포는
  `docs/deploy/`, 끝난 계획·이관 사양은 `docs/archive/`에 둡니다.
- 에이전트 실행 계획은 이슈마다 `.scratch/<이슈키>.md` 하나에 기록합니다. `.scratch/`는
  추적되지 않으므로 이어받을 때 경로를 직접 확인합니다.

## 커밋

- 형식은 `<타입>(<스코프>): <한국어 평서형 요약>`이며 마침표를 붙이지 않습니다.
- 타입은 `feat` `fix` `chore` `docs` `ci` `style` `refactor` `test`, 스코프는 `web` `api`
  `mobile`입니다. 루트·크로스커팅 변경은 스코프를 생략합니다.
- 릴리스 브랜치의 merge commit은 `release` 타입을 사용합니다.
- 이슈 키는 브랜치와 PR 제목에만 두고 커밋 메시지에는 넣지 않습니다.
- API 계약을 깨면 타입 뒤에 `!`를 붙이고 `BREAKING CHANGE:` footer에 호환 배포 순서를
  기록합니다.
