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
| `apps/web` | Next.js 화면과 API 프록시. API·서버 로직은 `apps/api`에 둡니다([서버 경계](apps/web/CLAUDE.md#서버-경계)). |
| `apps/api` | dev·운영이 함께 쓰는 유일한 Spring Boot 백엔드. |
| `apps/mobile` | Expo 앱. npm/EAS로 자립하며 pnpm 워크스페이스 밖에 있습니다. |
| `packages/*` | 실제 두 번째 사용처가 생긴 뒤에만 공유 패키지로 분리합니다. |

## 조건부 정본

- **제품 범위**를 정할 때 → [docs/PRD.md](docs/PRD.md)
- **화면·컴포넌트·카피**를 만들 때 → [acttub/pen](https://github.com/acttub/pen)과 [PRD 「디자인」](docs/PRD.md#디자인).
  어느 pen 파일이 앱·웹인지와 화면 번호 접두사는 [pen README](https://github.com/acttub/pen#readme)가 정하므로 여기에
  옮겨 적지 않습니다. 기능별 화면 번호는 [docs/specs/](docs/specs/README.md)의 `화면` 줄에 있습니다(앱 리딩부터 새 pen
  번호로 옮기는 중).
- **폴더·패키지 배치나 층 경계**를 정할 때 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **기능의 행동**(권한·오류 코드·한도·응답의 뜻·상태 전이)을 정하거나 바꿀 때 → [docs/specs/](docs/specs/README.md)의
  해당 기능 파일.
- **API·DB·마이그레이션**의 구현(영속·트랜잭션·락·스키마·오류 계약의 모양)을 바꿀 때 → [apps/api/CONTRACT.md](apps/api/CONTRACT.md).
  API 계약 변경과 소비 중인 필드·컬럼 축소는 [계약 변경 절차](apps/api/CONTRACT.md#계약-변경-절차)를
  함께 따릅니다.
- **브랜치·릴리스·hotfix·revert**를 다룰 때 →
  [docs/BRANCHING-STRATEGY.md](docs/BRANCHING-STRATEGY.md). `main` 머지는 운영 배포를 시작하며
  `main`·`dev`에는 직접 push하지 않습니다.
- **CI 잡을 추가·삭제·개명**할 때 → `.github/workflows/ci.yml` 머리 주석대로 GitHub ruleset을 함께 고칩니다.
- **dev·운영 배포**를 바꿀 때 → [DEPLOY-HOME.md](docs/deploy/DEPLOY-HOME.md)와
  `.github/workflows/deploy.yml`을 읽습니다.
  이전 AWS 구성의 배경이 필요할 때만 [보관 기록](https://github.com/acttub/acttub-platform/blob/c2b76b09/docs/archive/soma489/README.md)을 읽습니다.
- **이슈를 제안·착수하거나 브랜치·PR을 연결하거나 실행 계획(`.scratch/<이슈키>.md`)을 쓰고 이어받을** 때 →
  [issue-tracker.md](docs/agents/issue-tracker.md)
- **트리아지 라벨을 판단**할 때 → [triage-labels.md](docs/agents/triage-labels.md)
- **제품 개념의 이름을 짓거나 쓸 때, ADR을 제안·인용·변경하고 되돌리기 어려운 결정**을 다룰 때 →
  [domain.md](docs/agents/domain.md)(용어 표가 있는 곳과 ADR 절차)

## 저장소·문서 규칙

- JS는 pnpm, Java는 Gradle wrapper를 사용합니다. `apps/mobile`만 npm을 사용합니다. 다른
  lockfile을 추가하지 않습니다.
- 생성물과 로컬 디렉터리(`node_modules/`, `.next/`, `apps/api/build/`)는 수정 대상이 아닙니다.
- 크로스앱 문서는 `docs/`, 앱 상세 문서는 각 앱 디렉터리에 둡니다. `docs/` 최상위에는
  `PRD.md`·`ARCHITECTURE.md`·`ADR.md`·`BRANCHING-STRATEGY.md`만 둡니다. 기능 스펙은
  `docs/specs/<영역>/<기능>.md`, 배포는 `docs/deploy/`, 에이전트 작업 규칙은 `docs/agents/`, 끝난 계획·이관
  사양은 지우고 git 이력에 맡깁니다. 코드 주석이 가리키는 `docs/archive/...` 경로는 커밋 `c2b76b09`에서
  봅니다(`git show c2b76b09:docs/archive/<경로>`).

## 커밋

- 형식은 `<타입>(<스코프>): <한국어 평서형 요약>`이며 마침표를 붙이지 않습니다.
- 타입은 `feat` `fix` `chore` `docs` `ci` `style` `refactor` `test`, 스코프는 `web` `api`
  `mobile`입니다. 루트·크로스커팅 변경은 스코프를 생략합니다.
- 릴리스 PR 제목은 위 목록에 없는 `release` 타입을 쓰며, 형식은 [BRANCHING-STRATEGY 「PR과 Jira」](docs/BRANCHING-STRATEGY.md#pr과-jira)가
  정합니다.
- 커밋 메시지에는 이슈 키를 넣지 않습니다. 브랜치·PR 제목의 키는 [PR과 Jira](docs/BRANCHING-STRATEGY.md#pr과-jira)가 정합니다.
- API 계약을 깨면 타입 뒤에 `!`를 붙이고 `BREAKING CHANGE:` footer에 호환 배포 순서를
  기록합니다.
