# 아키텍처

세 앱의 배치와 데이터가 지나는 길을 한 번에 보는 지도다. 규칙의 정본은 각 절이 가리키는 문서이고,
여기에는 요약만 둔다. 개수와 경로는 2026-09-27 트리 기준이다.

## 디렉토리 구조

```
apps/
├── web/                  Next.js 화면 (pnpm 워크스페이스)
│   └── src/
│       ├── app/          라우트 (정적 프리렌더)
│       ├── features/     화면 단위 기능 14개 (workspace·practice·reading·library …)
│       └── lib/          공용 계층 — api/v2(백엔드 클라이언트)·react(useResource)·auth·analytics …
├── api/                  Spring Boot 백엔드, dev·운영 공용 (Gradle)
│   └── src/main/java/com/acttub/actingapi/
│       ├── feature/      비즈니스 도메인 18개 — 도메인마다 domain·app·adapter·schema
│       ├── platform/     배관 10개 — security·persistence·ledger·migration·observability …
│       └── integration/  외부 연동 5개 — llm(OpenAI)·observation(Gemini)·storage(S3)·media(ffmpeg)·oidc
└── mobile/               Expo 앱 (npm/EAS, 워크스페이스 밖)
    ├── app/              expo-router 라우트
    ├── components/
    └── lib/              api·auth·기능별 상태 모듈
packages/                 두 번째 사용처가 생길 때만 채운다
deploy/                   홈서버 배포 스크립트·모니터링 설정
docs/                     PRD·ARCHITECTURE·ADR·BRANCHING-STRATEGY, specs/(기능 스펙), deploy/, agents/
```

## 패턴

- **web** — 화면을 정적 프리렌더하고 `.next/standalone`을 Node로 서빙하며 `/v2/*`·`/health`만 API로
  프록시한다. Route Handler·Server Actions·middleware에 서버 로직을 두지 않는다
  → [apps/web/CLAUDE.md](../apps/web/CLAUDE.md) 「서버 경계」.
- **api** — 도메인별 헥사고날 구조다. `domain`은 프레임워크를 모르고, `app`이 서비스와 Port를 선언하며,
  `adapter`(web·db·storage·sched …)가 구현하고, `schema`가 JPA 엔티티를 둔다. 도메인끼리 직접 import하지
  않고 쓰는 쪽이 자기 `app`에 포트를 선언한다. 층은 넣을 것이 실재하는 만큼만 둔다. 이 규칙은
  ArchUnit 테스트(`PackageLayerTest`)가 강제한다 → [ADR-017·020](ADR.md), [CONTRACT](../apps/api/CONTRACT.md).
- **mobile** — expo-router 파일 라우팅이다. 백엔드 호출은 `lib/api.ts`·`lib/api-request.ts` 한 곳을
  지난다 → [apps/mobile/CLAUDE.md](../apps/mobile/CLAUDE.md).

### 연습 화면의 전환

연습 하나는 **Practice Stage** 여섯을 지난다(`준비 → 막힘 선택 → 업로드 → 분석 → 대화 → 연습 노트`).
"단계"라는 말이 이 제품에서 다섯 가지를 뜻해서 아래 이름으로 가르고, 수식 없이 "단계"라고만 쓰지 않는다.

| 용어 | 뜻 | 피할 말 |
|---|---|---|
| Practice Stage | 연습 하나가 지나가는 화면의 단계. 사람이 "지금 어디까지 왔나"로 읽는 단위다. | 단계(수식 없이), 모드, step, phase |
| Setup Step | 준비 화면 안에서 채우는 순서(영상 올리기 · 장면 적기 · 질문 받기). 화면이 바뀌지 않는다. | 단계(수식 없이), stage |
| Blockage Selection | 무엇에 막혔는지 고르는 갈래(큰 갈래 · 하위 갈래 · 상세). 고르지 않은 회차는 막힘 미특정이다([practice.start](specs/practice/start.md)). | 단계, 막힘 단계 |
| Analysis Status | 서버가 영상 분석의 진행을 말하는 값. 화면과 1:1이 아니다 — 실패는 화면을 바꾸지만 시작 전과 분석 중은 같은 화면이다. | 단계, 상태(수식 없이) |
| Upload Stage | 영상을 스토리지에 올리는 내부 구간(올릴 자리 받기 · 올리기 · 마무리). 사람에게 보이지 않고 실패 메시지를 가른다. 업로드 화면 하나에 셋이 다 들어간다. | 단계, 업로드 단계 |

- **웹**은 이 여섯이 **라우터 네비게이션 없이** 같은 컴포넌트 안에서 바뀐다
  (`features/workspace/workspace-state.ts`의 `WorkspaceScreen`). `/home`·`/practice/new`·`/practice/history`
  셋이 같은 `WorkspaceApp`을 렌더한다. 화면이 바뀔 때 주소는 `history.replaceState`로 갈아끼운다 —
  `router.replace`를 쓰면 `useSearchParams`를 감싼 Suspense가 다시 걸려 흰 화면이 깜빡인다. 로그인·로그아웃처럼
  화면을 실제로 옮기는 이동만 `router`를 쓴다.
- **모바일**은 라우트로 나뉘지만 **라우트 이름이 Practice Stage와 1:1이 아니다.** `app/upload`이 준비 화면이고,
  실제 업로드는 `analyzing`에서 분석과 함께 돈다:
  `app/upload`(준비) → `blockage`(막힘 선택) → `analyzing`(업로드·분석) → `coach`(대화) → `report`(연습 노트).

진행 표시를 만들 때 Practice Stage와 Setup Step을 섞지 않는다.

## 데이터 흐름

```
웹·앱 ── /v2/* ──▶ Spring Boot(apps/api) ──▶ PostgreSQL (스키마는 Flyway가 소유)
  │                   │
  │                   ├──▶ Gemini   영상 관찰·받아쓰기·직접 영상 코칭 (integration/observation)
  │                   ├──▶ OpenAI   2층 분류·대화, 3층 노트 문장 (integration/llm)
  │                   └──▶ S3       영상·사진 객체 (integration/storage)
  └── 업로드 예약으로 받은 URL로 S3에 직접 올림
```

- LLM과 미디어 처리는 DB 트랜잭션 밖에서 돈다.
  - 분석·배우 기억 갱신·챌린지 AI 리포트는 `ai_jobs` 원장의 비동기 작업이고, lease로 소유권을 관리한다
    → [practice.analyze](specs/practice/analyze.md#상태).
  - 코치 답변과 연습 노트는 요청 안에서 만들고, `state_revision` 검사와 요청 멱등 처리로 저장한다
    → [practice.coach](specs/practice/coach.md#상태).
  - `external_operations`는 옛 연습 흐름의 호환 원장이다 → [CONTRACT](../apps/api/CONTRACT.md) §5-7.
- 코칭은 세 층이다. 1층 영상 기록 → 2층 대화 → 3층 연습 노트
  → [specs/practice/](specs/practice/README.md).
- 웹의 API 타입은 API가 낸 `apps/api/spec/openapi.json`에서 생성한다(`pnpm --filter web generate:v2-schema`).

## 상태 관리

- **web** — 전역 상태 라이브러리가 없다. 서버 응답 하나가 화면의 단일 상태이면
  `src/lib/react/use-resource.ts`의 `useResource`를 쓰고, 목록 누적·폼·편집 상태는 컴포넌트 state로 둔다.
  토큰·refresh·멱등 재시도·429 백오프는 `src/lib/api/v2/`의 공용 클라이언트가 맡는다
  → [apps/web/CLAUDE.md](../apps/web/CLAUDE.md) 「데이터·API」.
- **mobile** — 전역 상태 라이브러리가 없다. 로그인 상태는 `lib/auth.tsx`의 React Context가 들고, 기기에
  남길 값은 `expo-secure-store`(자격증명)와 AsyncStorage에 둔다. 나머지는 `lib/`의 기능별 모듈과
  화면 state다.
- **server** — 사용자에게 보존을 약속하는 데이터의 정본은 PostgreSQL이다 → [ADR-008](ADR.md).

## 용어

기능 영역의 용어는 각 [스펙 영역](specs/README.md) README의 「용어」에 있다. 여기에는 영역을 가로지르는 구조 용어만 둔다.

| 용어 | 뜻 | 피할 말 |
|---|---|---|
| Domain Model | 비즈니스 규칙과 그 규칙이 다루는 값을 담은 객체. 프레임워크를 모른다 — 스프링·JPA·Jackson을 import하지 않으므로 스프링 컨텍스트나 DB 없이 세울 수 있다. 저장 형태(Schema Entity·SQL 행)나 전송 형태(요청·응답 DTO)와 별개이고, 그 사이의 변환은 어댑터가 한다(ADR-017). | 엔티티, 도메인 객체(수식 없이), VO |
| Port | 한 도메인이 바깥에 요구하는 것을 **쓰는 쪽**이 선언한 인터페이스. 쓰는 쪽이 배관일 수도 있다 — 요청 게이트가 사용자 조회를 요구하면 배관이 포트를 선언하고 도메인이 구현한다(ADR-017). 구현은 제공하는 쪽에 두고 구현 기술을 이름 앞에 단다(`PostgresPracticeSessionRepository`). 하네스 스텁 때문에 구현이 둘인 포트가 여럿이라 `Impl` 접미사는 쓰지 않는다. 시그니처에 제공자 패키지의 타입이 보이면 아직 안 끊긴 것이다. | 인터페이스(수식 없이), 추상화, DAO |
| Schema Entity | 테이블 모양을 그대로 나타내는 JPA 영속 객체. 스키마 검증과 런타임 읽기·쓰기에 함께 쓰이고, FK ID가 기본이며 승인된 단방향 FK 탐색 매핑만 허용한다. Domain Model과 분리한다(ADR-024). | 도메인 모델, 엔티티(수식 없이) |
| External Operation | 외부 호출(LLM·S3·영상 분석)을 수반해 한 트랜잭션 안에서 끝낼 수 없는 처리. 멱등키로 중복 생성을 막는다. 저장은 종류에 따라 갈린다 — 비동기 AI 요청은 AI Job, 탈퇴 뒤 객체 삭제·제공자 해제는 정리 장부(`account_cleanup_operations`)다. | 작업, 잡, 태스크, job |
| AI Job | 뒤에서 도는 AI 요청 하나(영상 분석·배우 기억 갱신·챌린지 AI 리포트, `AiJobKind`). `ai_jobs` 큐의 한 행이다. 코치 대화는 동기 요청이라 여기 속하지 않는다. 한국어로는 "AI 작업"이다. | 잡, 태스크, 백그라운드 작업(수식 없이) |
| Lease | 워커가 작업을 점유했다는 표식. 만료되면 다른 워커가 회수할 수 있고, 리스를 잃은 워커의 완료 처리는 거부된다. | 락, 점유권, lock |
| Report Source | 소유권 검증이 끝난, 리포트 생성에 필요한 코치 세션 문맥. 리포트 쪽이 요구하고 코치 쪽이 제공한다(`ReportSourceProvider`). | 리포트 컨텍스트, 세션 데이터 |
| Admissions | 대학 입시 공고 카탈로그. 인증의 admission control과 무관하다. | admission(단수형), 입장, 입장 제어 |

실패는 상태 코드의 다른 이름이 아니라, 받는 쪽이 할 일과 운영자에게 알릴지를 가르는 분류다(`platform/observability`).

| 용어 | 뜻 | 피할 말 |
|---|---|---|
| Expected Rejection (예상된 거절) | 요청이 규칙에 맞지 않아 서버가 거절한 것. 받는 쪽이 고칠 수 있거나(입력·토큰·동의) 정상적인 갈래다(없음·이미 있음·잠시 뒤). 운영자에게 알리지 않는다. | 클라이언트 오류, 4xx(수식 없이), 에러 |
| External Failure (바깥 의존 실패) | 네트워크를 건너는 호출(LLM·영상 분석·오브젝트 스토리지·로그인 제공자·푸시·DB)이 실패하거나 쓸 수 없는 답을 준 것. 받는 쪽은 잠시 뒤 다시 시도하고, 운영자에게 알린다. 같은 프로세스 안에서 도는 것(ffmpeg)의 실패는 여기 속하지 않는다. | 외부 오류, 인프라 장애, 502(수식 없이) |
| Unexpected Failure (예상 밖 실패) | 위 둘 어디에도 속하지 않는 실패 — 코드 결함, 깨진 불변식, 빠진 설정. 받는 쪽은 메시지만 받는다. 운영자에게 알린다. | 버그, 500(수식 없이), 서버 오류 |
