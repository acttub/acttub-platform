# apps/web 지침

## 적용 범위·스택

Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS v4. **정적 export 전용**(`BUILD_STATIC=1` → `output:'export'`) — 서버 런타임이 없습니다.

## 명령어 (이 디렉토리 기준)

- `pnpm dev` — 개발 서버(:3000). next.config rewrites가 `/v2/*`를 `http://127.0.0.1:8000`(acting-api)으로 프록시.
- `pnpm lint` · `pnpm typecheck`
- `pnpm test` — Node 테스트와 금지 카피 가드를 하나의 테스트 명령으로 실행.
- `pnpm build` — 정적 빌드 → `out/`
- `pnpm generate:v2-schema` — `../api/spec/openapi.json`에서 요청 타입 재생성(`src/lib/api/v2-schema.d.ts`). 이 파일은 직접 수정 금지.

## 구조

```text
src/
  app/        페이지 (전부 정적 프리렌더 + 클라이언트 렌더)
  features/   화면 모듈 (practice-flow, terms-gate, auth 가드)
  lib/
    api/v2/   acting-api v2 클라이언트 (도메인별 모듈)
    auth/     토큰 스토어·refresh·로그인 provider
    config/   env 스위치 (선택 변수는 env.ts 주석이 단일 문서)
```

## 정적 export 제약 (위반 시 빌드 실패 또는 런타임 오류)

- Route Handler·middleware·Server Actions·서버 `redirect()` 금지. 서버 로직은 전부 `apps/api` 소관.
- `useSearchParams`는 `<Suspense>` 내부에서만. 모듈 최상위에서 `window`/`navigator` 접근 금지.
- 비밀 금지: `NEXT_PUBLIC_*`만 클라이언트에 노출되며 빌드 시점에 번들에 새겨집니다.
- `crypto.randomUUID` 등 보안 컨텍스트 전용 API는 http(IP) 배포를 고려해 폴백 필수.

## API 호출 규칙

- UI는 반드시 `src/lib/api/v2/*` 모듈을 통해 호출합니다. fetch 직접 호출 금지.
- 토큰 부착·401 refresh(회전형 — 재사용 시 전 세션 무효화)·X-Request-Id 멱등 재시도·429 백오프는 전부 클라이언트 계층(`v2/client.ts`, `v2/idempotency.ts`, `auth/refresh.ts`)이 담당합니다. UI에서 재구현하지 않습니다.
- 404는 "없음"과 "남의 리소스" 겸용 — 중립 카피("~를 찾을 수 없어요")를 사용합니다.

## 스타일·카피

- Toss 스타일 인라인 Tailwind 유틸리티, 프레젠테이션 컴포넌트는 같은 파일의 로컬 함수로.
- 사용자 카피는 한국어 존댓말("~해요"). `tests/product-language-guard.test.mjs`가 `pnpm test` 안에서 금지 문구를 검사합니다.

## 테스트

`tests/*.test.mjs` — `node --test`. 필요한 테스트는 `tests/ts-module-loader.mjs` 커스텀 로더를 등록합니다. 이 로더는 확장자 없는 상대 경로 import를 `.ts`로 해석하고, TypeScript transpile로 parameter property를 포함한 문법을 변환합니다(`@/` 별칭 불가). 토큰 스토어는 Node 환경에서 메모리 모드로 동작해 그대로 테스트 가능합니다.
