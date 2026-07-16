# 아키텍처

## 시스템 구조

```
acttub-platform/            # pnpm 모노레포 — 제품과 상태의 정본
├── apps/web/               # Next.js 웹 앱 (현재 유일한 활성 개발 대상)
├── apps/api/               # 향후 Spring Boot 백엔드 자리 (현재 비움)
├── apps/mobile/            # 향후 React Native 앱 자리 (현재 비움)
├── packages/               # 두 번째 사용처가 생긴 뒤에만 분리하는 공유 패키지
└── docs/                   # PRD, ADR, API 계약, 디자인 레퍼런스
```

AI 기능(연기 연습 분석, AI 인터뷰, 리포트)은 플랫폼이 만들지 않는다. 외부 서비스인 acting-api를 호출해 사용하며, 엔드포인트·스키마·제한·에러는 `API.md`가 정본이다.

`apps/web` 목표 소스 구조:

```text
apps/web/src/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       └── v1/
│           └── practice-sessions/
│               ├── route.ts                  # 세션 생성 (영상 + 장면 맥락 → 분석)
│               └── [sessionId]/
│                   ├── route.ts              # 세션 상태 조회
│                   ├── turns/route.ts        # 인터뷰 turn 진행
│                   └── report/route.ts       # 리포트 생성·조회
├── components/
│   ├── ui/
│   └── layout/
├── features/
│   ├── session-input/
│   ├── interview/
│   └── report/
├── lib/
│   ├── api/
│   │   ├── client.ts
│   │   ├── sessions.ts
│   │   └── types.ts
│   └── config/
└── server/
    ├── services/
    ├── repositories/
    └── acting-api/          # acting-api HTTP 클라이언트 (X-API-Key 보관)
```

구조 규칙:

- 지금 필요한 폴더만 만든다. 빈 추상화 계층은 만들지 않는다.
- UI와 feature 코드는 `src/lib/api/*`를 통해서만 API를 호출한다.
- UI는 route handler, `src/server/*`, DB 구현을 직접 import하지 않는다.
- `src/app/api/**/route.ts`는 얇게 유지한다. 요청 파싱, service 호출, typed JSON 응답 반환만 담당한다.
- 임시 서버 로직은 `src/server/services`, 임시 데이터 접근은 `src/server/repositories`에 둔다.
- 공통 패키지는 실제 두 번째 사용처가 생긴 뒤에만 `packages/*`로 분리한다.

## 패턴

- **직렬 AI 파이프라인**: 분석 → 인터뷰 → 리포트 순서로만 진행하며, PRD 핵심 기능 2~4와 1:1로 대응한다.
- **API 키는 서버 측에만**: acting-api 호출은 서버 측(Route Handler / Server Action)에서만 하고, `X-API-Key`를 브라우저에 노출하지 않는다.
- **분석은 세션 시작 시 1회**: 인터뷰·리포트 단계에서 영상을 다시 보내거나 재분석하지 않는다.
- **휘발성 데이터의 플랫폼 복제 저장**: acting-api가 인메모리/휘발성 파일에 두는 대화 turn과 리포트는 생성 즉시 플랫폼 DB에 복제 저장한다 (ADR-015).
- versioned REST API 계약: `/api/v1/*`, 얇은 route handler + service/repository 분리, DTO 명시. 향후 Spring Boot 이전을 고려해 HTTP 계약을 안정적으로 유지한다.

## 데이터 흐름

```
영상 업로드 + 장면 맥락 입력 (platform)
        ↓
연기 연습 분석 (1회)
        ↓
AI 인터뷰 (API가 알려주는 종료 조건까지 반복)
        ↓
리포트 생성 · 이전 리포트 열람
```

각 단계의 acting-api 요청/응답 상세는 `API.md`를 따른다.

세션 생성 및 분석:

```text
UI → POST /api/v1/practice-sessions
   → route handler → session service
     ├─ 영상을 Supabase Storage에 저장
     ├─ session/take 레코드 저장
     ├─ acting-api POST /summarize 호출 (수 분 소요 가능 — 타임아웃 넉넉히)
     └─ SceneSummary를 플랫폼 DB에 저장
   → session 상태 반환 → UI
```

인터뷰 한 turn:

```text
사용자 답변 → POST /api/v1/practice-sessions/{sessionId}/turns
   → route handler → interview service
     ├─ acting-api POST /coach/start (첫 turn) 또는 /coach/reply 호출
     ├─ AI 발화와 배우 답변을 플랫폼 DB에 turn으로 복제 저장
     └─ done=true면 세션을 리포트 단계로 전환
   → 응답 DTO 반환 → UI
   (acting-api가 404를 주면 인메모리 세션 소멸 — 인터뷰를 처음부터 재시작)
```

리포트:

```text
UI → POST /api/v1/practice-sessions/{sessionId}/report
   → report service
     ├─ acting-api POST /report 호출
     └─ 리포트를 플랫폼 DB에 저장
   → 리포트 반환 → UI

이전 리포트 목록은 acting-api /report/history가 아니라
플랫폼 DB에 복제 저장된 리포트에서 조회한다 (acting-api 이력은 휘발성).
```

## 상태 관리

- 플랫폼이 소유(정본): 사용자(Supabase Auth), 업로드 영상(Supabase Storage), 세션 메타·SceneSummary·대화 turn 복제본·리포트(Postgres). Supabase RLS는 user_id 기준으로 켠다.
- acting-api가 소유: 인터뷰 라이브 세션(인메모리, 재배포 시 소멸). 플랫폼에 복제된 turn은 기록 보존용이며, 소멸된 인메모리 세션을 복원하는 데는 사용할 수 없다.
- acting-api의 리포트 `comparison`은 acting-api 내부 이력에 의존하므로, acting-api 재배포 후에는 비교가 비어 있을 수 있다 (알려진 제한, ADR-015 트레이드오프).

세션 상태 후보:

```text
INPUT       # 영상과 필수 맥락이 아직 제출되지 않았다
ANALYZING   # /summarize 진행 중
INTERVIEW   # /coach 대화 진행 중
REPORT      # 인터뷰 종료, 리포트 생성/열람
END         # 세션 종료
```

목표 데이터 모델 후보:

```text
practice_sessions
- id
- user_id
- status
- medium                 # legacy/response compatibility only; not active input
- genre                  # legacy/response compatibility only; not active input
- situation
- character_context
- subtext
- acting_session_id      # acting-api session_id (휘발성 참조)
- close_reason
- created_at
- updated_at

practice_takes
- id
- session_id
- storage_key
- duration_ms
- analysis_status
- analysis_error
- created_at

scene_summaries
- id
- session_id
- payload                # SceneSummary JSON (API.md 계약)
- created_at

practice_turns
- id
- session_id
- role                   # ai | actor
- text
- action                 # probe_intent | dig_cause | deflect | close
- focus_timestamp
- created_at

practice_reports
- id
- session_id
- user_id
- payload                # ActingReport JSON (API.md 계약)
- created_at
```

이 모델은 목표 구조다. 구현 시 필드와 의미가 무너지지 않게 DTO를 설계하고, acting-api 스키마 변경은 `API.md` 갱신과 함께 반영한다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| Platform | Next.js App Router, TypeScript, pnpm, Supabase (Auth/Postgres/Storage), Vercel |
| AI | 외부 acting-api (계약은 `API.md`, 내부 구현은 플랫폼 관심사 아님) |
| 향후 | `apps/api` Spring Boot 이전 — HTTP path와 DTO는 `/api/v1/*` REST 계약으로 안정 유지, `apps/mobile` React Native |
