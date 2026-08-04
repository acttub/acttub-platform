# apps/web 지침

## 적용 범위·스택

Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS v4.

빌드는 **서버 모드**(`output:'standalone'`) 하나뿐이며, 이것이 dev·운영이 실제로 배포하는 산출물입니다. **페이지는 전부 빌드 시점에 정적 프리렌더되며 요청마다 SSR하지 않습니다.** Node 프로세스가 뜨지만 역할은 정적 HTML 서빙 + `/v2/*` 프록시뿐입니다 — 운영은 백엔드가 private subnet에 있어 브라우저가 직접 닿지 못하므로 이 프록시가 유일한 통로이고, 개발 서버도 같은 경로를 씁니다.

## 서버 로직은 여기 두지 않습니다

**API·서버 로직은 전부 `apps/api`(FastAPI) 소관입니다.** Route Handler·Server Actions·middleware로 백엔드 로직을 만들지 않습니다.

이전에는 정적 export 빌드가 깨지는 것이 이 경계를 물리적으로 강제했지만, 그 모드를 걷어내면서 **이제 빌드는 통과합니다.** 통과한다고 해서 허용되는 것은 아닙니다 — 백엔드가 FastAPI와 Next 양쪽으로 흩어지면 인증·권한·계약 검증이 두 곳에 생깁니다. 서버에서 해야 할 일이 보이면 `apps/api`에 엔드포인트를 추가하고 `v2` 클라이언트로 호출하세요.

## 명령어 (이 디렉토리 기준)

- `pnpm dev` — 개발 서버(:3000). next.config rewrites가 `/v2/*`를 `http://127.0.0.1:8000`(acting-api)으로 프록시.
- `pnpm lint` · `pnpm typecheck`
- `pnpm test` — Node 테스트와 금지 카피 가드를 하나의 테스트 명령으로 실행.
- `pnpm build` — 빌드 → `.next/standalone/`(실제 배포 산출물). 프록시 대상은 `API_ORIGIN`으로 주며, rewrites가 빌드 시점에 `routes-manifest.json`으로 굳으므로 런타임 환경변수로는 바뀌지 않습니다. **typecheck보다 먼저 돌려야 합니다** — `next-env.d.ts`·`.next/types`를 만들어야 tsc가 `*.png` import와 typedRoutes를 해석합니다.
- `pnpm start` — 빌드 결과를 로컬에서 서빙(:3000). Lighthouse 측정이 이 명령을 씁니다.
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

## 정적 프리렌더 제약 (위반 시 빌드 실패 또는 런타임 오류)

페이지를 전부 빌드 시점에 프리렌더하므로 아래가 성립해야 합니다. 서버 전용 기능 금지는
위 "서버 로직은 여기 두지 않습니다"를 따릅니다.

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
