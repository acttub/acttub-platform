# SPEC: 로그인 provider 기본화 — Google 기본 + "dev"→"development" 전면 리네임

## 배경/목적

현재 구글 로그인은 `NEXT_PUBLIC_AUTH_PROVIDER=google` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` env를
빌드 시점에 넣어야만 활성화된다. env 누락 시 로그인 버튼이 안 뜨는 사고 여지가 있고,
"dev" provider라는 이름은 이제 "개발 서버"가 아니라 "로컬 전용 테스트 로그인"을 뜻하므로
오해를 부른다.

목표:

1. **Google 로그인을 코드 기본값으로**: client ID를 프론트·백엔드 양쪽에 하드코딩하고
   프론트 env 스위치를 전부 제거한다.
2. **development 폼은 로컬 `next dev`에서만**: `process.env.NODE_ENV === "development"` 게이트.
   프로덕션 빌드에서는 죽은 코드 제거로 산출물에서 사라진다.
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
  - `tests/v2-module-surface.test.mjs`의 내부 심볼 불변식이 `devProvider`·`googleProvider`를
    "export 금지 내부 선언"으로 고정하고 있으므로, 두 provider의 export를 의도된 공개
    표면으로 재정의해 불변식 목록을 갱신한다.
- `src/app/login/page.tsx`
  - Google 버튼은 **항상** 렌더. `GOOGLE_CLIENT_ID` 부재 분기(설정 안내 카피)는 제거
    (상수가 항상 존재하므로 dead code).
  - development 로그인 폼은 `process.env.NODE_ENV === "development"`일 때만 Google 버튼
    **아래에** 추가 렌더. 폼 섹션에 "개발용 테스트 로그인" 류의 구분 레이블을 달아
    Google 버튼과 시각적으로 구분한다 (카피는 존댓말 "~해요" 규칙 준수).
  - **에러·진행 상태 영역은 페이지에 하나만 둔다**: 현재 상호배타 분기가 각자 에러/notice를
    렌더하는 구조인데, 두 컨트롤이 동시에 보이면 중복 표시되므로 공유 busy/error/notice
    영역을 단일화한다 (Google 버튼·폼 어느 쪽 제출이든 같은 영역에 표시).
  - credential 콜백 → `loginWith(googleProvider, { credential })`,
    폼 submit → `loginWith(developmentProvider, { uid, email })` 직결.
- `.env.production` **파일 삭제** (내용이 전부 코드 기본값과 동일해짐).
- `tests/providers.test.mjs`: spawnSync + `NEXT_PUBLIC_AUTH_PROVIDER` env 스위치 제거.
  단, 커스텀 로더(`tests/ts-module-loader.mjs`)는 side-effect import로 훅을 등록하므로
  provider 모듈은 **정적 import가 아니라 로더 import 이후 top-level `await import(...)`**
  로 가져온다 (정적 import는 훅 등록 전에 링크되어 `.ts` 해석이 실패한다).

### 백엔드 (`apps/api/acting-api`)

- `src/acting_api/auth/dev.py` → `development.py`: `DevelopmentProviderVerifier`,
  `provider = "development"`. 토큰 파싱 로직(`uid` 또는 `uid:email`)은 동일 유지.
- `src/acting_api/config.py`
  - `dev_auth_provider` → `development_auth_provider`,
    env 키 `DEV_AUTH_PROVIDER` → `DEVELOPMENT_AUTH_PROVIDER`. 하위 호환 alias는 두지 않는다
    (배포 env는 이 PR과 함께 갱신).
  - `google_oauth_client_id`: env `GOOGLE_OAUTH_CLIENT_ID` 미설정 시 **프론트와 동일한
    client ID를 기본값으로 사용** (env는 오버라이드 용도로 유지). env 누락 시 503
    `provider_not_configured`로 죽던 반쪽 기본화를 해소한다.
    `tests/test_gateway_config.py`의 기본값 검증도 함께 갱신.
- `src/acting_api/app.py`: 배선 갱신 (`DevelopmentProviderVerifier` 등록 조건).
- `src/acting_api/db/models.py`: `IdentityProvider.DEV = "dev"` → `DEVELOPMENT = "development"`.
- **alembic 0003**: `ALTER TYPE identity_provider_t RENAME VALUE 'dev' TO 'development'`
  (PostgreSQL 10+; `values_callable`이 Python enum value를 저장하므로 라벨 리네임으로 기존
  행이 자동 추종, 데이터 재작성 없음). downgrade는 역방향 RENAME.
- **마이그레이션 테스트** (`RUN_DB_TESTS=1` 게이트, 기존 DB 픽스처 활용):
  0002까지 upgrade → raw SQL로 `provider='dev'` 행 시드 → 0003 upgrade →
  해당 행이 `'development'`로 읽히는지 검증. (기존 픽스처는 빈 스키마를 head로 올려
  기존 행 마이그레이션을 증명하지 못하므로 별도 케이스 필요.)
- 테스트: `tests/test_dev_auth.py` → `test_development_auth.py` 등 "dev" provider를 참조하는
  테스트·서포트(`auth_test_support.py`, `platform_test_support.py` 등) 일괄 갱신.
  **회귀 추가**: development provider가 **등록된 상태**에서 `provider: "dev"` 요청이
  400 `unsupported_provider`로 거부되는지 검증 (기존 부정 테스트는 비활성 상태만 증명).
- **API 계약**: `LoginRequest.provider`는 자유 문자열(`str`)을 유지한다 — Literal/enum으로
  좁히면 미지원 provider가 422로 바뀌어 기존 400 `unsupported_provider` 계약이 깨진다.
  따라서 `apps/api/spec/openapi.json` 재생성은 provider 관점에서 no-op일 수 있으며,
  재생성 후 diff 유무만 확인해 반영한다 (웹 타입 재생성 포함, 경로 주의:
  스펙 파일은 `apps/api/spec/openapi.json`이 정본이고 `apps/api/acting-api/spec/`은 없다).

### 문서

- `apps/api/acting-api/README.md`·`apps/api/CLAUDE.md`·루트 `CLAUDE.md` 등에서
  dev 로그인/env 스위치 언급을 실태에 맞게 갱신. 로컬 개발 루프 명령을
  `DEVELOPMENT_AUTH_PROVIDER=1 uv run uvicorn ...`으로 문서화한다
  (development 폼이 보이는데 백엔드가 거부하는 기본 조합을 문서로 해소).
  README의 "프로덕션에서 절대 켜지 말 것" 경고는 유지·강화한다.
- 잔존 참조 검사: env 변수명 grep에 더해 **의미 검사**를 포함한다 — provider wire 값
  `"dev"`, 심볼(`devProvider`, `DevProviderVerifier`, `dev_auth_provider`), 파일명(`dev.py`,
  `test_dev_auth.py`)이 alembic 히스토리·과거 문서 기록·통상적 "next dev" 용어를 제외하고
  0건이어야 한다.

### 배포 절차 메모 (코드 밖, PR 설명에 포함)

- enum RENAME은 구코드(‘dev’ 바인딩)와 신코드(‘development’ 바인딩)가 동시에 살아 있으면
  어느 방향이든 깨진다. 현재 운영은 FastAPI 단일 프로세스이므로
  **구프로세스 정지 → `alembic upgrade head` → 신코드 기동** 순서로 배포한다 (롤링 불가).
- **롤백도 대칭**: 코드만 되돌리면 구 ORM이 `'development'` 라벨을 읽지 못한다.
  롤백 시 반드시 `alembic downgrade 0002`를 코드 롤백과 결합한다 (정지 → downgrade → 구코드 기동).
- 배포 환경에 `DEV_AUTH_PROVIDER`가 설정돼 있으면 **키를 교체하지 말고 제거**한다
  (development provider는 프로덕션에서 꺼져 있어야 한다).
- `GOOGLE_OAUTH_CLIENT_ID`를 오버라이드하는 배포는 웹 번들의 하드코딩 값과 동일해야 한다
  — 다르면 audience 불일치로 구글 로그인 전면 401 (config.py 주석에도 명시).

## 완료 기준 체크리스트

- [ ] `pnpm build` 후 `out/` 하위 **모든 HTML/JS 산출물**에서 development 폼 고유
      sentinel 문자열(예: 폼 구분 레이블 카피)이 0건 — 이 산출물 스캔이 제거의 증명이다
      (소스 조건식이 아니라).
- [ ] `next dev` 화면: Google 버튼 + development 폼이 함께 표시되고, 에러/진행 영역은
      페이지에 하나만 존재한다.
- [ ] env 변수 없이 빌드해도 Google 버튼이 활성화된다 (`NEXT_PUBLIC_*` 로그인 관련 변수 0개).
- [ ] 백엔드가 `GOOGLE_OAUTH_CLIENT_ID` env 없이도 google provider를 기본 client ID로
      등록한다 (env 설정 시 오버라이드).
- [ ] `POST /v2/auth/login`에 `provider: "development"`가 통하고, development provider가
      **등록된 상태에서도** `"dev"`는 400 `unsupported_provider`.
- [ ] `DEVELOPMENT_AUTH_PROVIDER=1`일 때만 development provider가 등록된다 (기본 꺼짐).
- [ ] `RUN_DB_TESTS=1` 마이그레이션 테스트: 0002 + `'dev'` 행 시드 → 0003 upgrade →
      `'development'`로 조회됨.
- [ ] 잔존 참조 0건: env 변수명(`DEV_AUTH_PROVIDER`·`NEXT_PUBLIC_AUTH_PROVIDER`·
      `NEXT_PUBLIC_GOOGLE_CLIENT_ID`) + wire 값·심볼·파일명 의미 검사
      (alembic 히스토리·과거 문서 기록 제외).
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] `cd apps/api && uv run pytest` 통과.
- [ ] `apps/api/spec/openapi.json` 재생성 후 diff 확인·반영,
      `pnpm --filter web generate:v2-schema` 재생성 반영 (no-op이면 무변경 확인 기록).

## 하지 말 것 (스코프 제한)

- 다중 provider 버튼 목록(레지스트리) 일반화 — 두 번째 소셜 provider 추가 시점의 과제.
- 카카오/네이버/애플 연동, 자체(이메일/비밀번호) 로그인.
- `IdentityProvider.KAKAO`/`APPLE` enum 값 정리 — 건드리지 않는다.
- `LoginRequest.provider`의 Literal/enum 타입 강화 — 400→422 계약 파괴.
- development provider에 대한 백엔드 프로덕션 가드(환경 감지 등) 도입 — 아래 기각 기록 참조.
- 스코프 밖 리팩터링·스타일 변경.
- `v2-schema.d.ts` 수동 편집 (재생성만 허용).

## 리뷰 지적 처리 기록 (Codex 설계 비판)

- **기각 — "development provider 미강제가 계정 탈취 허용" (Blocker 지적)**:
  `DEVELOPMENT_AUTH_PROVIDER=1` + 직접 API 호출 시 `uid:email`만으로 verified 이메일 연결이
  되는 위험은 사실이나, 이는 **이번 변경으로 새로 생기는 위험이 아니라 기존 dev provider의
  기존 특성**이다. 방어선은 "프로덕션에서 flag를 켜지 않는다"(README 경고 유지·강화)이며,
  백엔드에 환경 감지 가드를 도입하는 것은 새 환경 개념을 추가하는 스코프 확장이라 기각.
  사용자 결정(2026-07-19). 배포 메모에 "키 교체가 아니라 제거" 원칙으로 반영.
- **Phase 6 최종 리뷰 처리 (2026-07-20)**:
  - 수용 — `next dev`를 `--hostname 127.0.0.1`로 고정 (LAN에서 dev 서버 프록시 경유로
    development 로그인 우회 접근 가능하던 노출 차단, 한 줄 수정).
  - 경량 수용 — `GOOGLE_OAUTH_CLIENT_ID` env 값 strip + 웹 번들과 동일해야 한다는 주석·배포 메모.
    오버라이드 자체 제거는 기각 (client ID 교체 시 탈출구로 의도적으로 유지).
  - 문서 수용 — 롤백 시 DB downgrade 결합 필수를 배포 메모에 추가.
    expand-contract 마이그레이션은 기각 (단일 프로세스 운영에 과설계).
- 수용: 백엔드 client ID 기본값(#2), 배포 절차 메모(#3), 마이그레이션 테스트(#4),
  모듈 표면 불변식 갱신(#5), provider 자유 문자열 유지·경로 정정(#6·#12),
  동적 import 테스트 구조(#7), 로컬 명령 문서화(#8), 산출물 sentinel 스캔(#9),
  활성 상태 "dev" 400 회귀·의미 검사(#10), 공유 에러 영역 단일화(#11).

## 미결 사항

- Google Console 승인된 JavaScript 원본에 `http://localhost:3000` 등록 여부 — 코드 밖
  운영 작업. 미등록이면 로컬에서 Google 버튼이 뜨되 로그인 시도가 실패한다 (기능 자체는
  development 폼으로 대체 가능하므로 블로커 아님).
