# SPEC: 웹 로그인 페이지 Google Identity Services(GIS) 연동

## 배경/목적

- 백엔드 `/v2/auth/login`(provider=google)은 이미 구현·검증됨 (`apps/api/acting-api/src/acting_api/auth/google.py` — ID 토큰 서명 검증).
- 웹은 `NEXT_PUBLIC_AUTH_PROVIDER=google`일 때 "Google 로그인 준비 중" 비활성 버튼만 있음.
- 목적: GIS 공식 렌더 버튼으로 credential(ID 토큰)을 받아 기존 로그인 플로우(`loginWith` → 약관 게이트 → 리다이렉트)에 연결한다.

## 확정된 결정

1. **렌더 버튼만** 사용. One Tap(`prompt()`) 사용 안 함.
2. **환경 스위치 유지 (either/or)**: 기본(dev 서버·로컬)은 uid/email dev 폼, 운영 빌드만 Google 버튼.
3. **`apps/web/.env.production` 커밋**으로 운영 빌드 설정 고정 (`next build` 시 자동 로드, `next dev`에는 미적용):
   - `NEXT_PUBLIC_AUTH_PROVIDER=google`
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<발급 후 교체>` (클라이언트 ID는 공개 값 — 커밋 가능)
4. **실패 처리**: 버튼 자리에 기존 에러 카피 스타일 안내문.
   - 클라이언트 ID 미설정 → "Google 로그인 설정이 필요해요"
   - GIS 스크립트 로드 실패 → "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요"
   - 로그인 API 실패(401/403 등)는 기존 `loginErrorMessage` 재사용.
5. **버튼 외형**: `theme: filled_blue`, `shape: pill`, `size: large`, 너비는 컨테이너 폭(최대 400px).

## 설계

### 변경 파일

1. **`apps/web/src/lib/config/env.ts`**
   - `GOOGLE_CLIENT_ID` export 추가 (`process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""`).
   - 파일 주석 규약(env.ts 주석이 선택 변수의 단일 문서)에 맞춰 용도 주석 추가.

2. **`apps/web/src/lib/auth/google-gis.ts` (신규)**
   - GIS 스크립트(`https://accounts.google.com/gsi/client`) 동적 로더: 중복 로드 방지(단일 promise 캐시), `onerror` 시 reject.
   - `window.google.accounts.id`에 대한 최소 TypeScript 타입 선언(전역 `declare` — 외부 @types 패키지 추가 금지).
   - `initialize({ client_id, callback })` + `renderButton(el, options)` 래퍼 함수 제공.
   - 모듈 최상위에서 `window` 접근 금지 (정적 프리렌더 제약) — 함수 내부에서만 접근.

3. **`apps/web/src/lib/auth/providers.ts`**
   - `LoginProvider.getIdToken` 입력에 `credential?: string` 추가.
   - `googleProvider.getIdToken`: `input.credential`이 있으면 반환, 없으면 throw (기존 pending 에러 제거).

4. **`apps/web/src/app/login/page.tsx`**
   - 로그인 성공 후처리(`pending_consents` 저장 → `/terms` 또는 `next` 리다이렉트)를 dev 폼과 Google 콜백이 공유하도록 로컬 함수로 추출.
   - `AUTH_PROVIDER === "google"` 분기: 로컬 컴포넌트 `GoogleLoginButton`
     - `GOOGLE_CLIENT_ID`가 빈 값이면 스크립트 로드 없이 "Google 로그인 설정이 필요해요" 표시.
     - `useEffect`에서 GIS 로드 → initialize(콜백: credential 수신 시 `loginWith(googleProvider, { credential })` → 공유 후처리) → 컨테이너 div에 renderButton.
     - 로드 실패 시 "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요" 표시.
     - 로그인 진행 중 상태(중복 제출 방지)와 API 에러 표시는 기존 상태/카피 재사용.

5. **`apps/web/.env.production` (신규)** — 위 확정 결정 3 내용.

### 백엔드 (코드 변경 없음)

- API 계약 불변 → openapi 스펙·웹 타입 재생성 불필요.
- 운영 `.env`(`apps/api/acting-api/.env`)에 `GOOGLE_OAUTH_CLIENT_ID=<클라이언트 ID>` 추가 필요 — 코드 아닌 배포 설정 (미결 사항 참조).

### 테스트

- `apps/web/tests/`에 providers 유닛 테스트 추가/확장 (`node --test` + ts-module-loader):
  - `googleProvider.getIdToken({ credential })` → credential 그대로 반환.
  - credential 없이 호출 → throw.
  - dev provider 기존 동작 회귀 없음.
- GIS 버튼 렌더(DOM/외부 스크립트)는 Node 테스트 범위 밖 — 수동 검증으로 대체.
- 카피 가드(`product-language-guard`)는 `pnpm --filter web test`에 포함되어 자동 검사.

### 검증 명령

```bash
pnpm lint && pnpm typecheck && pnpm --filter web test && pnpm build
```

## 완료 기준 체크리스트

- [ ] `NEXT_PUBLIC_AUTH_PROVIDER=google` + 클라이언트 ID 설정 시 로그인 페이지에 GIS 공식 버튼(filled_blue/pill/large)이 렌더된다.
- [ ] 버튼 클릭 → Google 계정 선택 → credential이 `/v2/auth/login`(provider=google)으로 전달되고, 성공 시 dev 로그인과 동일하게 약관 게이트/리다이렉트가 동작한다.
- [ ] 클라이언트 ID 미설정 시 "Google 로그인 설정이 필요해요" 안내가 표시된다.
- [ ] GIS 스크립트 로드 실패 시 "Google 로그인을 불러오지 못했어요..." 안내가 표시된다.
- [ ] 기본(dev) 모드의 uid/email 폼 동작에 회귀가 없다.
- [ ] `apps/web/.env.production`이 커밋되어 `pnpm build`만으로 운영 빌드가 google 모드가 된다.
- [ ] providers 유닛 테스트 추가, `pnpm lint`·`pnpm typecheck`·`pnpm --filter web test`·`pnpm build` 전부 통과.

## 하지 말 것 (스코프 제한)

- One Tap(`prompt()`), FedCM 관련 설정 추가 금지.
- 백엔드(apps/api) 코드·스펙 변경 금지.
- dev 폼 UI/로직 리팩터링 금지 (후처리 공유 추출 외).
- `fetch` 직접 호출 금지 — 반드시 `lib/api/v2/*` 경유 (기존 규칙).
- 토큰 저장·refresh·멱등 재시도 계층 수정 금지.
- 외부 패키지(@types/google.accounts 등) 추가 금지 — 로컬 타입 선언으로 해결.

## 미결 사항

- **Google OAuth 클라이언트 ID 미발급**: 사용자가 Google Cloud Console에서 발급 후 두 곳에 설정해야 실동작 확인 가능 — `apps/web/.env.production`의 placeholder 교체 + 운영 `apps/api/acting-api/.env`에 `GOOGLE_OAUTH_CLIENT_ID` 추가. 발급 전까지 Google 플로우 E2E는 검증 불가(코드 검증은 유닛 테스트·빌드로 갈음).
- 운영 도메인이 http+IP인 경우 GIS가 동작하지 않음(secure context 필요) — HTTPS 도메인 준비 여부는 배포 시점 확인.
