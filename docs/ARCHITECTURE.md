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
docs/                     PRD·ARCHITECTURE·ADR·BRANCHING-STRATEGY, specs/(기능 스펙), deploy/, agents/, archive/
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
이름은 [CONTEXT.md](../CONTEXT.md)가 정본이다.

- **웹**은 이 여섯이 **라우터 네비게이션 없이** 같은 컴포넌트 안에서 바뀐다
  (`features/workspace/workspace-state.ts`의 `WorkspaceScreen`). `/home`·`/practice/new`·`/practice/history`
  셋이 같은 `WorkspaceApp`을 렌더한다. 화면이 바뀔 때 주소는 `history.replaceState`로 갈아끼운다 —
  `router.replace`를 쓰면 `useSearchParams`를 감싼 Suspense가 다시 걸려 흰 화면이 깜빡인다. 로그인·로그아웃처럼
  화면을 실제로 옮기는 이동만 `router`를 쓴다.
- **모바일**은 라우트로 나뉘지만 **라우트 이름이 Practice Stage와 1:1이 아니다.** `app/upload`이 준비 화면이고,
  실제 업로드는 `analyzing`에서 분석과 함께 돈다:
  `app/upload`(준비) → `blockage`(막힘 선택) → `analyzing`(업로드·분석) → `coach`(대화) → `report`(연습 노트).

준비 화면 안에서 사람이 채우는 순서는 **Setup Step**이고(`CONTEXT.md`), 화면이 바뀌지 않고 같은 자리에서
진행되므로 Practice Stage와 다른 층이다. 진행 표시를 만들 때 둘을 섞지 않는다.

## 데이터 흐름

```
웹·앱 ── /v2/* ──▶ Spring Boot(apps/api) ──▶ PostgreSQL (스키마는 Flyway가 소유)
  │                   │
  │                   ├──▶ Gemini   영상 관찰·받아쓰기·직접 영상 코칭 (integration/observation)
  │                   ├──▶ OpenAI   2층 분류·대화, 3층 노트 문장 (integration/llm)
  │                   └──▶ S3       영상·사진 객체 (integration/storage)
  └── 업로드 예약으로 받은 URL로 S3에 직접 올림
```

- LLM과 미디어 처리는 DB 트랜잭션 밖에서 돈다. 분석·코치·노트 같은 비동기 작업은 `external_operations`
  원장이 lease로 소유권을 관리한다 → [CONTRACT](../apps/api/CONTRACT.md) §5-7.
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
