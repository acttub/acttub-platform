# Harness 워크플로우

이 문서는 Acttub 프로젝트에서 구현 작업을 작은 phase step으로 나누어 계획하고 실행하기 위한 공통 원본이다. Claude Code wrapper와 Codex skill은 워크플로우를 복제하지 말고 이 문서를 참조한다.

Acttub 적용 기준:

- 제품 기준은 `docs/PRD.md`를 따른다.
- 아키텍처 기준은 `docs/ARCHITECTURE.md`를 따른다.
- 결정사항은 `docs/ADR.md`를 따른다.
- UI 기준은 `docs/UI_GUIDE.md`와 `docs/Toss-DESIGN.md`를 따른다.
- 추가 제품 지식은 로컬 참고 저장소 `/Users/insung/Documents/GitHub/acttub/second_brain`를 참고하되, 구현 저장소의 정본 문서는 이 `docs/` 디렉토리다.

## 개요

이 하네스는 프로젝트 작업을 작고 독립적인 phase step으로 나누어 계획하고 실행하기 위한 프레임워크다. 하네스 자체는 기술 스택에 중립적이어야 하며, 구현 작업을 실행하기 전에 대상 프로젝트의 실제 스택, 명령어, 아키텍처, 설계 결정을 `AGENTS.md`와 `docs/*.md`에 채운다.

Acttub에서 하네스가 반드시 지켜야 할 제품 불변 조건:

- acttub은 질문 기반 AI 연기 연습 파트너다.
- AI는 배우를 평가하지 않는다.
- 사용자 표면에 점수, 등급, 4축 평가, 피드백 카드, 강점/약점/개선점 카드를 만들지 않는다.
- 질문 대화가 핵심 화면이다.
- 질문은 한 번에 하나만 한다.
- rejected observation은 후속 질문 근거로 재사용하지 않는다.
- 세션 종료는 AI 결론 카드가 아니라 배우가 직접 쓴 자기 정리 문장으로 마무리한다.

## A. 탐색

`AGENTS.md`와 `docs/` 아래 파일을 읽고 프로젝트의 제품 의도, 아키텍처, 디자인 제약, 의사결정을 파악한다.

Acttub 작업 전 기본 읽기 순서:

1. `AGENTS.md`
2. `apps/web/AGENTS.md` 또는 작업 앱의 AGENTS 문서
3. `docs/PRD.md`
4. `docs/ADR.md`
5. `docs/ARCHITECTURE.md`
6. `docs/UI_GUIDE.md`
7. UI 세부 구현이면 `docs/Toss-DESIGN.md`

제품 지식이 더 필요할 때 참고할 second brain 파일:

- `/Users/insung/Documents/GitHub/acttub/second_brain/index.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/concepts/question-dialogue-spec.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/concepts/ai-behavior-contract.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/concepts/system-architecture.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/concepts/input-context-schema.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/concepts/user-journey.md`
- `/Users/insung/Documents/GitHub/acttub/second_brain/decisions/mvp-question-dialogue-scope.md`

탐색 시 확인할 현재 구현 사실:

- 현재 활성 앱은 `apps/web`이다.
- 현재 `apps/web/src/app/page.tsx`는 Next 기본 화면 수준이다.
- 실제 세션, 업로드, AI, DB, API 구현은 아직 없다.
- `apps/api` Spring Boot와 `apps/mobile` React Native는 예정 영역이다.

## B. 논의

구현 전에 명확히 해야 할 요구사항이나 기술 결정이 있으면 phase 파일을 작성하기 전에 사용자에게 선택지를 제시한다.

단, 아래는 이미 결정된 기준으로 보고 다시 묻지 않는다:

- pnpm workspace 사용
- `apps/web` 우선 개발
- Next.js App Router 사용
- 임시 API는 `/api/v1/*` REST 계약 선호
- 장기 백엔드는 `apps/api` Spring Boot
- 질문 기반 UX 채택
- 4축 평가/피드백 카드 폐기
- MVP 범위는 질문 대화와 배우 자기 정리까지
- before/after 비교는 후속 범위
- 초기 멀티모달 파인튜닝 제외
- YouTube 참고 영상은 공식 임베드만 허용
- UI는 `docs/Toss-DESIGN.md`를 레퍼런스로 삼고 `docs/UI_GUIDE.md`를 Acttub 적용 기준으로 사용

사용자 확인이 필요한 경우:

- 결제, 회원가입, 개인정보 수집처럼 정책/법적 범위가 바뀌는 작업
- 새로운 외부 서비스나 유료 API 도입
- DB 종류, 배포 플랫폼, 인증 방식처럼 되돌리기 어려운 기술 선택
- 제품 표면에 평가/점수/리포트 성격이 다시 들어오는 요구사항
- Toss 레퍼런스와 다른 독자 브랜드 시스템을 확정하는 결정

## C. Step 설계

사용자가 구현 계획을 요청하면 여러 개의 작은 step 초안을 만들고, 파일을 생성하기 전에 피드백을 받는다.

Step 설계 규칙:

1. **범위를 최소화한다**: 각 step은 하나의 레이어, 모듈, 동작에 집중한다. 여러 모듈을 동시에 바꿔야 하면 step을 나눈다.
2. **각 step을 독립적으로 만든다**: `stepN.md`는 독립 agent 세션에서 실행된다. 이전 대화 맥락에 의존하지 않는다.
3. **준비 작업을 강제한다**: 작업 전에 읽어야 할 관련 문서와 파일을 명시한다.
4. **전체 구현이 아니라 인터페이스를 지정한다**: 필요한 함수/클래스 시그니처와 불변 조건은 포함하되, 아키텍처상 중요한 부분이 아니면 구현 세부사항은 agent에게 맡긴다.
5. **실행 가능한 Acceptance Criteria를 쓴다**: 대상 프로젝트에 실제로 존재하는 명령어를 넣는다.
6. **경고를 구체적으로 쓴다**: 모호한 주의 대신 "X를 하지 마라. 이유: Y" 형식으로 작성한다.
7. **kebab-case 이름을 쓴다**: step 이름은 `session-input`, `api-contract`, `question-dialogue`, `observation-state` 같은 짧은 slug로 작성한다.

Acttub step 분리 예시:

- `web-shell`: 기본 레이아웃, 토큰, 폰트, 앱 metadata 정리
- `session-input`: 영상 업로드 UI와 장면 맥락 입력 폼
- `api-contract`: `/api/v1/sessions` DTO와 임시 route handler
- `observation-confirmation`: 관찰 확인 상태 UI와 API
- `question-dialogue`: 질문 turn UI와 turn 생성 API 연결
- `session-summary`: 배우 자기 정리 입력과 종료 화면
- `validation-events`: 검증 로그 DTO와 저장 경계

권장 Acceptance Criteria:

```bash
pnpm lint
pnpm build
```

필요 시 더 좁은 명령:

```bash
pnpm lint:web
pnpm build:web
```

## D. 파일 생성

사용자가 계획을 승인한 뒤에만 아래 파일을 생성한다.

### `phases/index.json`

전체 task의 상위 index다. 이미 존재하면 새 phase entry를 추가한다.

```json
{
  "phases": [
    {
      "dir": "0-mvp",
      "status": "pending"
    }
  ]
}
```

필드:

- `dir`: task 디렉토리 이름.
- `status`: `"pending"` | `"completed"` | `"error"` | `"blocked"`.
- `completed_at`, `failed_at`, `blocked_at` 같은 timestamp는 executor가 작성한다. 파일 생성 시 직접 넣지 않는다.

### `phases/{task-name}/index.json`

task의 상세 index다.

```json
{
  "project": "acttub-platform",
  "phase": "<task-name>",
  "steps": [
    { "step": 0, "name": "web-shell", "status": "pending" },
    { "step": 1, "name": "session-input", "status": "pending" },
    { "step": 2, "name": "api-contract", "status": "pending" }
  ]
}
```

필드:

- `project`: `acttub-platform`.
- `phase`: task 이름. 디렉토리 이름과 맞춘다.
- `steps[].step`: 0부터 시작하는 step 번호.
- `steps[].name`: kebab-case slug.
- `steps[].status`: 초기값은 `"pending"`.

상태 전환:

| 전환 | 필드 | 작성 주체 |
| --- | --- | --- |
| `completed` | `completed_at`, `summary` | agent가 `summary`를 쓰고 executor가 timestamp를 쓴다 |
| `error` | `failed_at`, `error_message` | agent가 message를 쓰고 executor가 timestamp를 쓴다 |
| `blocked` | `blocked_at`, `blocked_reason` | agent가 reason을 쓰고 executor가 timestamp를 쓴다 |

`summary`는 이후 step의 context로 전달된다. 변경 파일, 핵심 결정, 생성한 DTO, API path, UI 상태 이름 같은 유용한 구현 사실을 포함한다.

`created_at`과 step-level `started_at`은 executor가 작성한다. 파일 생성 시 직접 넣지 않는다.

### `phases/{task-name}/step{N}.md`

step마다 파일을 하나씩 만든다.

````markdown
# Step {N}: {name}

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `AGENTS.md`
- `apps/web/AGENTS.md`
- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/ADR.md`
- `docs/UI_GUIDE.md`
- {이전 step에서 생성/수정된 파일 경로}

UI 세부 구현이면 추가로 읽어라:

- `docs/Toss-DESIGN.md`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

{구체적인 구현 지시. 파일 경로, 컴포넌트/함수/DTO 시그니처, API path, 상태 이름, 로직 설명을 포함한다.
코드 스니펫은 인터페이스/시그니처 수준만 제시하고, 구현체는 agent에게 맡긴다.
단, 설계 의도에서 벗어나면 안 되는 핵심 규칙은 명확히 박아넣어라.}

Acttub 불변 조건:

- 평가/점수/강점/약점/개선점 UI를 만들지 마라.
- 질문은 한 번에 하나만 보여줘라.
- rejected observation을 질문 근거로 쓰지 마라.
- UI는 `src/lib/api/*`를 통해 API를 호출하게 하라.
- route handler는 얇게 유지하라.

## Acceptance Criteria

```bash
pnpm lint
pnpm build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `ARCHITECTURE.md` 디렉토리 구조를 따르는가?
   - `ADR.md` 기술 결정을 벗어나지 않았는가?
   - `PRD.md` MVP 범위를 벗어나지 않았는가?
   - `UI_GUIDE.md`의 금지 UI/카피를 만들지 않았는가?
   - `AGENTS.md`와 앱별 `AGENTS.md` 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/{task-name}/index.json`의 해당 step을 업데이트한다:
   - 성공 -> `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 -> `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 -> `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단
   - 네트워크 접근, workspace 밖 쓰기, GUI 조작, 승인 escalation이 필요한데 현재 agent 환경에서 처리할 수 없음 -> `"blocked"`로 기록

## 금지사항

- 점수/등급/4축 평가를 만들지 마라. 이유: 제품 정체성이 평가 서비스로 바뀐다.
- 강점/약점/개선점 카드를 만들지 마라. 이유: 폐기된 피드백 카드 프레이밍이다.
- UI에서 route handler 또는 `src/server/*`를 직접 import하지 마라. 이유: Spring Boot 이전 경계가 무너진다.
- Server Action을 핵심 백엔드 계약으로 쓰지 마라. 이유: 모바일 앱과 Spring Boot 이전이 어려워진다.
- rejected observation을 후속 질문 근거로 재사용하지 마라. 이유: 사용자 안전성과 신뢰를 해친다.
- 기존 테스트를 깨뜨리지 마라.
````

## E. 실행

현재 `acttub-platform`에는 하네스 executor script가 들어와 있지 않다. 따라서 executor가 도입되기 전까지는 step 문서를 사람이 읽고 Codex/Claude 세션에서 직접 실행한다.

executor가 도입된 뒤에는 공통 executor로 실행한다:

```bash
python3 scripts/execute.py {task-name} --agent codex    # Codex로 실행
python3 scripts/execute.py {task-name} --agent claude   # Claude로 실행
python3 scripts/execute.py {task-name}                  # 기본값: Claude
python3 scripts/execute.py {task-name} --agent codex --push
python3 scripts/execute.py {task-name} --agent claude --push
```

실행 전 조건:

- 작업트리가 깨끗해야 한다. 기존 사용자 변경이나 미커밋 phase 파일이 있으면 먼저 commit 또는 stash한다.
- 선택한 agent CLI가 PATH에 있어야 한다.
- `--agent` 플래그는 executor가 step 실행에 어떤 agent CLI(`claude` 또는 `codex`)를 스폰할지 선택한다. 현재 세션이 어떤 도구인지와는 무관하며, 생략하면 `claude`가 기본값이다.
- Node/pnpm 환경에서 `pnpm lint`와 `pnpm build`가 실행 가능해야 한다.

executor가 담당하는 일:

- `feat-{task-name}` 브랜치 생성 또는 checkout (task 디렉토리 이름 기준)
- `AGENTS.md`와 `docs/*.md`의 guardrail 주입
- 완료된 step summary를 이후 step에 전달
- 실패한 step을 설정된 retry limit까지 재시도. agent는 세션 안에서 자체적으로 수정을 시도한 뒤 `error`를 기록할 수 있으므로, executor retry와 곱해져 전체 시도 횟수는 retry limit보다 커질 수 있다.
- timestamp 작성
- step output JSON 캡처
- 구현 커밋과 housekeeping 커밋 분리
- 실패하거나 차단된 step의 부분 구현 변경은 정상 `feat`가 아니라 `wip` 커밋으로 보존

복구:

- `error`: 문제를 수정한 뒤 해당 step을 `"pending"`으로 되돌리고 `error_message`를 제거한 다음 재실행한다.
- `blocked`: `blocked_reason`을 해결한 뒤 해당 step을 `"pending"`으로 되돌리고 `blocked_reason`을 제거한 다음 재실행한다.

Agent 세션은 파일을 수정하고 step status를 업데이트한다. 사용자가 명시적으로 executor를 우회하라고 하지 않는 한 직접 커밋하지 않는다.

## F. 리뷰

변경 사항 리뷰의 공통 체크리스트다. Claude Code wrapper와 Codex skill은 이 섹션을 참조하고 복제하지 않는다.

리뷰 전에 `AGENTS.md`, `docs/HARNESS.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ADR.md`, `docs/UI_GUIDE.md`를 읽는다.

체크리스트:

1. **제품 정체성 준수**: 질문 기반 연습 파트너이며, 평가/피드백 서비스처럼 보이지 않는가?
2. **아키텍처 준수**: `ARCHITECTURE.md`에 정의된 디렉토리 구조와 UI/API/server 경계를 따르고 있는가?
3. **기술 스택 준수**: `ADR.md`에 정의된 기술 선택을 벗어나지 않았는가?
4. **MVP 범위 준수**: before/after, retake, 점수, 성장 리포트처럼 제외한 범위가 들어오지 않았는가?
5. **UI 가이드 준수**: Toss 레퍼런스와 Acttub UI 금지사항을 지키는가?
6. **카피 안전성**: 점수, 등급, 약점, 개선점, 진단 결과, 피드백 카드 같은 금지 표현이 사용자 표면에 없는가?
7. **관찰 상태 안전성**: rejected observation이 후속 질문 근거로 재사용되지 않는가?
8. **테스트 존재**: 새로운 기능에 대한 테스트 또는 검증 가능한 대체 체크가 있는가?
9. **CRITICAL 규칙**: `AGENTS.md`의 CRITICAL 규칙을 위반하지 않았는가?
10. **검증 가능**: 실제 검증 명령을 실행했는가? 실행하지 못했다면 이유가 명확한가?

출력 형식:

| 항목 | 결과 | 비고 |
|------|------|------|
| 제품 정체성 준수 | ✅/❌ | {상세} |
| 아키텍처 준수 | ✅/❌ | {상세} |
| 기술 스택 준수 | ✅/❌ | {상세} |
| MVP 범위 준수 | ✅/❌ | {상세} |
| UI 가이드 준수 | ✅/❌ | {상세} |
| 카피 안전성 | ✅/❌ | {상세} |
| 관찰 상태 안전성 | ✅/❌/해당 없음 | {상세} |
| 테스트 존재 | ✅/❌/해당 없음 | {상세} |
| CRITICAL 규칙 | ✅/❌ | {상세} |
| 검증 가능 | ✅/❌/미정의 | {상세} |

위반 사항이 있으면 수정 방안을 구체적으로 제시한다.
