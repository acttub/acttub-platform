# 아키텍처

이 문서는 `acttub-platform`의 현재 구현 구조와 목표 제품 구조를 함께 기록한다. 현재 저장소는 pnpm 모노레포이며, 활성 개발 대상은 `apps/web`의 Next.js 웹 앱이다. 장기적으로는 `apps/api`에 Spring Boot 백엔드, `apps/mobile`에 React Native 앱이 들어올 수 있다.

제품 구조의 핵심은 “영상을 한 번 분석하고, 저장된 관찰과 대화 이력을 바탕으로 질문을 이어가는 세션 시스템”이다. 대화 내용과 세션 상태는 DB가 정본이어야 하며, 서버는 매 turn마다 DB에서 필요한 상태를 다시 읽어 새로고침/이어하기에 안전해야 한다.

## 디렉토리 구조
현재 저장소 구조:

```text
acttub-platform/
├── AGENTS.md
├── README.md
├── docs/
│   ├── ADR.md
│   ├── ARCHITECTURE.md
│   ├── HARNESS.md
│   ├── PRD.md
│   ├── UI_GUIDE.md
│   └── Toss-DESIGN.md
├── apps/
│   ├── web/
│   │   ├── AGENTS.md
│   │   ├── package.json
│   │   └── src/
│   │       └── app/
│   │           ├── api/
│   │           │   └── AGENTS.md
│   │           ├── globals.css
│   │           ├── layout.tsx
│   │           └── page.tsx
│   ├── api/       # 예정: Spring Boot backend
│   └── mobile/    # 예정: React Native app
├── packages/
│   └── README.md
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

`apps/web` 목표 소스 구조:

```text
apps/web/src/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       └── v1/
│           ├── sessions/
│           │   └── route.ts
│           └── sessions/[sessionId]/
│               ├── route.ts
│               ├── observations/route.ts
│               ├── turns/route.ts
│               └── summary/route.ts
├── components/
│   ├── ui/
│   └── layout/
├── features/
│   ├── session-input/
│   ├── observation-confirmation/
│   ├── question-dialogue/
│   └── session-summary/
├── lib/
│   ├── api/
│   │   ├── client.ts
│   │   ├── sessions.ts
│   │   └── types.ts
│   └── config/
└── server/
    ├── services/
    ├── repositories/
    ├── ai/
    └── validation/
```

구조 규칙:

- 지금 필요한 폴더만 만든다. 빈 추상화 계층은 만들지 않는다.
- UI와 feature 코드는 `src/lib/api/*`를 통해서만 API를 호출한다.
- UI는 route handler, `src/server/*`, DB 구현을 직접 import하지 않는다.
- `src/app/api/**/route.ts`는 얇게 유지한다. 요청 파싱, service 호출, typed JSON 응답 반환만 담당한다.
- 임시 서버 로직은 `src/server/services`, 임시 데이터 접근은 `src/server/repositories` 또는 `src/server/db`에 둔다.
- 공통 패키지는 실제 두 번째 사용처가 생긴 뒤에만 `packages/*`로 분리한다.

## 패턴
사용하는 기본 패턴:

- pnpm workspace 기반 모노레포
- Next.js App Router
- TypeScript
- Tailwind CSS
- 기본 Server Component, 필요할 때만 Client Component
- versioned REST API 계약: `/api/v1/*`
- 얇은 route handler + service/repository 분리
- DTO 명시와 HTTP 계약 안정화
- 향후 Spring Boot 이전을 고려한 프론트엔드/API 경계

제품 도메인 패턴:

- 세션 중심 모델
  - 하나의 연습 흐름은 `session`으로 묶는다.
  - 세션은 입력 맥락, 진행 상태, 영상 take, 관찰, 질문 turn, 종료 자기 정리를 가진다.

- 영상 분석 1회 원칙
  - 영상은 세션 시작 시 한 번 분석한다.
  - 이후 turn은 저장된 관찰과 대화 이력을 사용한다.
  - 대화 turn마다 전체 영상을 다시 분석하지 않는다.

- DB source of truth
  - 세션 상태, 관찰 상태, turn 로그, 종료 문장은 DB가 정본이다.
  - 서버 메모리, React state, AI provider response는 정본이 아니다.
  - 새로고침, 재접속, 이어하기가 가능해야 한다.

- 관찰 상태 관리
  - 관찰은 `unasked`, `accepted`, `rejected`, `unsure` 상태를 가진다.
  - `accepted`만 grounded question의 근거가 될 수 있다.
  - `rejected`는 후속 질문 근거에서 제외한다.
  - `unsure`는 확정 근거로 쓰지 않고 추가 확인 또는 다른 질문 경로로 돌린다.

- 질문 단위 생성
  - 한 turn은 질문 하나만 생성한다.
  - 질문은 accepted observation, explicit missing context, boundary redirect 중 하나를 근거로 가진다.
  - guardrail checker는 점수/평가/처방/복수질문/금지 표현을 검사한다.

목표 데이터 모델 후보:

```text
coach_sessions
- id
- actor_id or anonymous_token
- status
- medium
- genre
- situation
- character_context
- subtext
- final_actor_sentence
- created_at
- updated_at

coach_takes
- id
- session_id
- video_url or storage_key
- duration_ms
- analysis_status
- analysis_error
- created_at

coach_observations
- id
- take_id
- timestamp_start_ms
- timestamp_end_ms
- observation_text
- confidence
- confirmation_state
- blocked_for_questioning
- source_payload
- created_at

coach_turns
- id
- session_id
- speaker
- content
- question_focus
- source_observation_ids
- turn_state
- created_at

validation_events
- id
- session_id
- event_type
- payload
- created_at
```

이 모델은 목표 구조다. MVP 초기에 mock persistence를 쓰더라도 위 필드와 의미가 무너지지 않게 DTO를 설계한다.

## 데이터 흐름

> API path note: the current canonical session API is `/api/v1/practice-sessions/*`. Older `/api/v1/sessions/*` routes are compatibility aliases only and should not be used as the primary contract in new work.

세션 생성 및 첫 질문:

```text
사용자
  │
  │ 1. 영상 + 장면 맥락 제출
  ▼
apps/web UI
  │
  │ 2. POST /api/v1/practice-sessions
  ▼
Next Route Handler
  │
  │ 3. 입력 검증, session 생성 요청
  ▼
Session Service
  │
  ├─ 4. 영상 저장
  ├─ 5. session/take 저장
  ├─ 6. AI 분석 요청
  ├─ 7. observation 저장
  └─ 8. 첫 확인 질문 또는 첫 질문 생성
  ▼
DB / Storage / AI Provider
  │
  │ 9. session 상태 반환
  ▼
apps/web UI
```

분석 대기:

```text
UI
  │
  │ GET /api/v1/practice-sessions/{sessionId}
  ▼
API
  │
  │ session.status, analysis_status, first_question 확인
  ▼
UI
```

한 turn:

```text
사용자 답변
  │
  │ POST /api/v1/practice-sessions/{sessionId}/turns
  ▼
Route Handler
  │
  │ request DTO 검증
  ▼
Question Service
  │
  ├─ DB에서 session, observations, turns 로드
  ├─ rejected observation 제외
  ├─ 다음 질문 초점 선택
  ├─ AI provider로 질문 후보 생성
  ├─ guardrail checker 실행
  ├─ question turn 저장
  └─ response DTO 반환
  ▼
UI
```

관찰 확인:

```text
UI: 맞음 / 아님 / 모르겠음
  │
  │ PATCH /api/v1/practice-sessions/{sessionId}/observations/{observationId}
  ▼
API
  │
  │ confirmation_state 업데이트
  ▼
DB
  │
  │ accepted만 질문 후보 근거로 허용
  ▼
Question Service
```

세션 종료:

```text
UI
  │
  │ POST /api/v1/practice-sessions/{sessionId}/summary
  ▼
API
  │
  │ actor-authored filled-thought sentence 저장
  ▼
DB
  │
  │ validation event 저장
  ▼
UI: 자기 정리 + 다시 볼 질문
```

YouTube 참고 영상이 들어올 경우:

```text
UI
  │
  │ videoId/URL metadata 요청
  ▼
API
  │
  │ 공식 embed 가능 metadata만 저장
  ▼
UI: YouTube iframe 또는 IFrame Player API
```

금지:

- YouTube 원본 영상, 오디오, 프레임, 자막 다운로드
- YouTube 콘텐츠 RAG 인덱싱
- 임베드 제한 우회

## 상태 관리
클라이언트 상태:

- 입력 폼 상태: 로컬 component state 또는 form library가 도입되면 feature 내부에서 관리한다.
- 업로드 진행률, pending 버튼, optimistic UI처럼 화면 상호작용에만 필요한 상태는 클라이언트에 둘 수 있다.
- 서버 정본과 충돌할 수 있는 세션 상태는 클라이언트에만 보관하지 않는다.

서버 상태:

- `session.status`는 DB가 정본이다.
- `take.analysis_status`는 DB가 정본이다.
- `observation.confirmation_state`는 DB가 정본이다.
- `turns`는 append-only에 가깝게 다룬다. 수정이 필요하면 상태 필드나 새 이벤트로 남긴다.

세션 상태 후보:

```text
INPUT
ANALYZING
OBSERVE_CONFIRM
PROBE_LOOP
HINT
INSIGHT
SAFE_EXIT
END
```

상태 의미:

- `INPUT`: 영상과 필수 맥락이 아직 제출되지 않았다.
- `ANALYZING`: 영상 분석과 초기 관찰 저장이 진행 중이다.
- `OBSERVE_CONFIRM`: 불확실하거나 해석 위험이 있는 관찰을 사용자에게 확인한다.
- `PROBE_LOOP`: accepted 관찰과 입력 맥락을 바탕으로 질문을 이어간다.
- `HINT`: 사용자가 막혔을 때 정답 대신 생각의 발판을 준다.
- `INSIGHT`: 사용자가 의도와 실제 간극을 자기 말로 정리한다.
- `SAFE_EXIT`: 질문 상한, 반복 막힘, 사용자 종료 등으로 안전하게 마무리한다.
- `END`: 세션이 종료되어 결과가 잠긴다.

관찰 상태 후보:

```text
unasked
accepted
rejected
unsure
```

질문 생성 불변 조건:

- 질문은 한 번에 하나만 생성한다.
- 질문에는 source가 있어야 한다.
- source는 accepted observation, explicit missing context, boundary redirect 중 하나다.
- rejected observation은 질문 source가 될 수 없다.
- low/medium confidence 관찰은 사용자 확인 없이 확정 근거로 쓰지 않는다.
- 금지 표현이 포함된 질문은 사용자에게 노출하지 않는다.

검증 상태:

- `felt_scored_1_7`이 높게 나오면 UI/카피가 평가처럼 느껴졌다는 신호다.
- `rejected_observation_reuse_count` 목표는 0이다.
- `forbidden_language_count` 목표는 0이다.
- `final_sentence_result`는 통과, 부분 통과, 실패, 안전 종료로 기록한다.

현재 구현 상태:

- `apps/web`은 Next.js 기본 화면 상태다.
- 실제 세션, 업로드, AI, DB, API 구현은 아직 없다.
- 따라서 이 문서는 목표 아키텍처와 구현 시 지켜야 할 계약을 먼저 정의한다.
