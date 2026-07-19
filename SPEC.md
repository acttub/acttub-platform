# SPEC: 로그인 provider 기본화 — Google 기본 + "dev"→"development" 전면 리네임

## 배경/목적

현재 구글 로그인은 `NEXT_PUBLIC_AUTH_PROVIDER=google` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` env를
빌드 시점에 넣어야만 활성화된다. env 누락 시 로그인 버튼이 안 뜨는 사고 여지가 있고,
"dev" provider라는 이름은 이제 "개발 서버"가 아니라 "로컬 전용 테스트 로그인"을 뜻하므로
오해를 부른다.

목표:

1. **Google 로그인을 코드 기본값으로**: client ID를 하드코딩하고 env 스위치를 전부 제거한다.
2. **dev 폼은 로컬 `next dev`에서만**: `process.env.NODE_ENV === "development"` 게이트.
   프로덕션 빌드에서는 tree-shaking으로 제거된다.
3. **"dev" → "development" 전면 리네임**: 프론트 심볼, 백엔드 provider 키(wire 값), env 변수,
   DB enum 값까지 일관되게 바꾼다.

## 설계

### 프론트 (`apps/web`)

- `src/lib/config/env.ts`
  - `AUTH_PROVIDER` 제거. `GOOGLE_CLIENT_ID`는 env 조회 없이 순수 하드코딩:
    `462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com`
    (OAuth client ID는 공개 값이므로 번들 포함 무방 — 주석으로 명시)
- `src/lib/auth/providers.ts`
  - `getLoginProvider()` 전역 스위치 제거.
  - `googleProvider`와 `developmentProvider`(구 devProvider, `name: "development"`)를 각각 export.
  - `LoginProvider.name` 타입: `"development" | "google"`.
- `src/app/login/page.tsx`
  - Google 버튼은 **항상** 렌더. `GOOGLE_CLIENT_ID` 부재 분기(설정 안내 카피)는 제거
    (상수가 항상 존재하므로 dead code).
  - 로컬 로그인 폼은 `process.env.NODE_ENV === "development"`일 때만 Google 버튼
    **아래에** 추가 렌더. 폼 섹션에 "로컬 테스트 로그인" 류의 구분 레이블을 달아
    Google 버튼과 시각적으로 구분한다 (카피는 존댓말 "~해요" 규칙 준수).
  - credential 콜백 → `loginWith(googleProvider, { credential })`,
    폼 submit → `loginWith(developmentProvider, { uid, email })` 직결.
- `.env.production` **파일 삭제** (내용이 전부 코드 기본값과 동일해짐).
- `tests/providers.test.mjs`: env 스위치(spawnSync + NEXT_PUBLIC_AUTH_PROVIDER) 제거,
  두 provider를 직접 import해 검증하는 구조로 재작성.

### 백엔드 (`apps/api/acting-api`)

- `src/acting_api/auth/dev.py` → `development.py`: `DevelopmentProviderVerifier`, `provider = "development"`.
  토큰 파싱 로직(`uid` 또는 `uid:email`)은 동일 유지.
- `src/acting_api/config.py`: `dev_auth_provider` → `development_auth_provider`,
  env 키 `DEV_AUTH_PROVIDER` → `DEVELOPMENT_AUTH_PROVIDER`. 하위 호환 alias는 두지 않는다
  (배포 env는 이 PR과 함께 갱신).
- `src/acting_api/app.py`: 배선 갱신 (`DevelopmentProviderVerifier` 등록 조건).
- `src/acting_api/db/models.py`: `IdentityProvider.DEV = "dev"` → `DEVELOPMENT = "development"`.
- **alembic 0003**: `ALTER TYPE identity_provider_t RENAME VALUE 'dev' TO 'development'`
  (PostgreSQL 10+; 기존 행은 자동 추종, 데이터 재작성 없음). downgrade는 역방향 RENAME.
- 테스트: `tests/test_dev_auth.py` → `test_development_auth.py` 등 "dev" provider를 참조하는
  테스트·서포트(`auth_test_support.py`, `platform_test_support.py` 등) 일괄 갱신.
- `spec/openapi.json` 재생성 → 웹 타입 재생성(`pnpm --filter web generate:v2-schema`)
  → 프론트 반영 (API 계약 변경은 한 PR 원칙).

### 문서

- `apps/web/CLAUDE.md`·README 등에서 dev 로그인/env 스위치 언급이 있으면 실태에 맞게 갱신.
- 저장소 내 "DEV_AUTH_PROVIDER"·"NEXT_PUBLIC_AUTH_PROVIDER" 잔존 참조를 grep으로 확인해 0으로.

## 완료 기준 체크리스트

- [ ] `pnpm build` 산출물에서 로컬 로그인 폼 문자열이 검출되지 않는다 (tree-shaking 확인).
- [ ] `next dev` 화면: Google 버튼 + 로컬 테스트 로그인 폼이 함께 표시된다.
- [ ] env 변수 없이 빌드해도 Google 버튼이 활성화된다 (`NEXT_PUBLIC_*` 로그인 관련 변수 0개).
- [ ] `POST /v2/auth/login`에 `provider: "development"`이 통하고 `"dev"`는 `unsupported_provider`(400).
- [ ] `DEVELOPMENT_AUTH_PROVIDER=1`일 때만 development provider가 등록된다 (기본 꺼짐).
- [ ] alembic upgrade가 기존 `provider='dev'` 행을 `'development'`로 보이게 한다 (RENAME VALUE).
- [ ] 저장소에서 `DEV_AUTH_PROVIDER`·`NEXT_PUBLIC_AUTH_PROVIDER`·`NEXT_PUBLIC_GOOGLE_CLIENT_ID`
      참조가 alembic 히스토리·과거 문서 기록을 제외하고 0건.
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] `cd apps/api && uv run pytest` 통과.
- [ ] `spec/openapi.json`·`v2-schema.d.ts` 재생성 반영.

## 하지 말 것 (스코프 제한)

- 다중 provider 버튼 목록(레지스트리) 일반화 — 두 번째 소셜 provider 추가 시점의 과제.
- 카카오/네이버/애플 연동, 자체(이메일/비밀번호) 로그인.
- `IdentityProvider.KAKAO`/`APPLE` enum 값 정리 — 건드리지 않는다.
- 스코프 밖 리팩터링·스타일 변경.
- `v2-schema.d.ts` 수동 편집 (재생성만 허용).

## 미결 사항

- Google Console 승인된 JavaScript 원본에 `http://localhost:3000` 등록 여부 — 코드 밖
  운영 작업. 미등록이면 로컬에서 Google 버튼이 뜨되 로그인 시도가 실패한다 (기능 자체는
  로컬 폼으로 대체 가능하므로 블로커 아님).
- 배포 환경의 `DEV_AUTH_PROVIDER` env가 켜져 있다면 배포 시 `DEVELOPMENT_AUTH_PROVIDER`로
  키 교체 필요 (배포 절차 메모).
