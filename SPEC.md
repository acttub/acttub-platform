# SPEC — 회원가입 시 동의 수집 활성화 (발행 자동화 + 서버 강제)

브랜치: `feat/signup-consent` (base: `dev` = 5155dc0)
범위: 프론트엔드 · 백엔드 · DB(데이터/seed). **모바일 앱 미변경.**

## 배경 / 목적

동의 수집 플로우는 이미 **전 계층에 구현**돼 있다:

- **DB 스키마**: `consent_documents`(unique(type,version)), `user_consents`(append-only 이벤트 로그) — 마이그레이션 0001. 스키마 변경 불필요.
- **백엔드**: `POST /v2/auth/login`이 미동의 필수 문서를 `pending_consents`로 반환(`auth/router.py:84,120`). `POST /v2/consents`로 기록, `GET /v2/consents/documents`로 목록.
- **웹**: 로그인 후 `pending_consents`가 있으면 `/terms`로 보내고(`login/page.tsx:229`), `terms-gate.tsx`가 필수 체크·제출·부분실패 재시도·403/404 처리까지 완비. `use-require-auth.ts` 가드.
- **모바일**: "가입 마무리" 화면 완비.

**그런데 동작하지 않는다.** 이유는 두 가지다.

1. **문서가 DB에 발행되지 않는다.** `publish_consent_document`는 수동 CLI로만 호출되고 자동 발행 코드가 없다 → `pending_consents`가 항상 비어 게이트가 안 뜬다. (`consent_docs/README.md`가 경고.)
2. **서버 강제가 없다.** 동의 안 해도 보호 엔드포인트 접근 가능(advisory-only). 웹 게이트는 localStorage 의존 + `refresh` 응답에 pending 없음 → **저장소를 지우거나 다른 기기로 재접속하면 동의 없이 앱 사용 가능**.

목적: (A) 문서를 앱 시작 시 자동 발행하고, (B) 필수 동의 전 보호 엔드포인트를 서버에서 차단하며, (C) 웹이 그 차단을 받아 동의 게이트를 띄우도록 배선한다.

## 설계

### A. 문서 발행 자동화 (앱 시작 시 idempotent seed) — 백엔드 + DB(데이터)

- **매니페스트**: `consent_docs/manifest.json` 신설 — 발행 대상의 단일 소스.
  ```json
  [
    {"file": "terms_v1.md",       "type": "terms",       "version": "v1", "title": "이용약관",         "required": true},
    {"file": "privacy_v1.md",     "type": "privacy",     "version": "v1", "title": "개인정보처리방침", "required": true},
    {"file": "ai_analysis_v1.md", "type": "ai_analysis", "version": "v1", "title": "AI 분석 동의",     "required": true}
  ]
  ```
- **config**: `GatewaySettings`에 `consent_docs_dir: Path | None` 추가. env `CONSENT_DOCS_DIR`, 기본값 `Path(config.py).resolve().parents[2] / "consent_docs"` (= acting-api 루트 기준, `.env` 경로와 동일 패턴).
- **store 헬퍼**: `get_consent_document_by_type_version(type, version) -> ConsentDocument | None` 추가 (idempotency 판정용).
- **seed 함수**: `acting_api/consents.py: seed_consent_documents(store, docs_dir) -> int` (발행 건수 반환).
  - `docs_dir`/`manifest.json` 없으면 warning 로그 후 0 반환 (**비치명적** — 부팅을 막지 않는다).
  - 매니페스트 각 항목: 이미 (type, version) 발행돼 있으면 skip, 없으면 파일 본문 읽어 `publish_consent_document(...)`. `IntegrityError`(동시 부팅 경합) catch 후 skip.
- **lifespan 배선**: `app.py`의 `lifespan` startup(‌`yield` 이전)에서 `run_in_threadpool(seed_consent_documents, store, gateway_settings.consent_docs_dir)` 호출. **try/except로 감싸 실패해도 부팅 계속** (로그만 남김).

### B. 서버측 강제 (enforcement) — 백엔드

- **pending 로직 중앙화**: `auth/router.py:_pending_consents`의 판정을 재사용 가능한 함수로 추출.
  - store 헬퍼 `has_pending_required_consents(user_id) -> bool`: 최신 필수 문서 중 해당 유저의 현재 action이 `granted`가 아닌 것이 하나라도 있으면 True. (`list_latest_consent_documents` + `get_current_user_consents` 재사용.)
  - 기존 `_pending_consents`도 동일 소스를 쓰도록 정리(중복 제거, 동작 불변).
- **게이트 의존성**: `auth/dependencies.py`에 `build_consent_gate_dependency(rate_limited_user, store)` → `consented_user` 추가.
  ```python
  async def consented_user(user = Depends(rate_limited_user)):
      if await run_in_threadpool(store.has_pending_required_consents, user.id):
          raise HTTPException(status_code=403, detail="consent_required")
      return user
  ```
- **배선 (app.py만 수정)**: `consented_user`를 만들어 **uploads · practice · coaching · reports** 라우터의 `rate_limited_user=` 인자로 전달. `consented_user`가 내부적으로 `rate_limited_user`를 depend하므로 **네 라우터 파일은 무변경**.
  - **면제(그대로 `rate_limited_user`)**: `consents`(동의 기록 — 신규 유저가 게이트를 통과하려면 필수), `auth`(logout).
- 오류 형식은 FastAPI 표준 `{"detail": "consent_required"}` 유지 (프로젝트 규칙).

### C. 웹 프론트엔드 — 403 처리 + 게이트 서버소싱

- **중앙 403 처리**: `lib/api/v2/client.ts`(`apiFetch`)에서 응답이 `status 403 && code === "consent_required"`이면 세션 이벤트 `consent-required` emit(`lib/auth/session-events.ts`에 이벤트 추가).
- **전역 리스너**: 앱 루트에 마운트되는 작은 client 컴포넌트가 `consent-required`를 구독 → `router.replace('/terms?next=<현재경로>&consent=required')`. (화면마다 가드가 없어도 동작하도록 전역.)
- **게이트 서버소싱** (`terms-gate.tsx` `loadDocuments` 수정):
  - localStorage pending 있으면 → 기존대로 pending(interactive) 모드.
  - 없고 `searchParams.get("consent") === "required"`이면 → `GET /v2/consents/documents`로 받아 **required 문서를 interactive(pending) 모드**로 표시. (localStorage 소실/타기기 재접속/기존 유저 대응.)
  - 둘 다 아니면 → 기존 info(read-only) 모드.
  - 제출 성공 경로는 기존과 동일(`recordConsent` → `clearPendingConsents` → `enterApp(next)`).
- 계약 변경 없음(엔드포인트 신설 없음). 그래도 openapi 재생성 절차는 수행 — 실제 스키마 diff는 없거나 미미.

## 완료 기준 체크리스트

- [ ] `consent_docs/manifest.json` 존재, 3종 매핑 정확.
- [ ] 로컬 API를 빈 consent DB로 부팅하면 3종이 자동 발행되고, `GET /v2/consents/documents`가 3건 반환.
- [ ] 재부팅해도 중복 발행되지 않음(발행 건수 0, 여전히 3건).
- [ ] `consent_docs`/manifest가 없어도 부팅이 실패하지 않음(경고 로그만).
- [ ] 필수 동의 미완료 유저가 uploads·practice·coaching·reports 중 하나를 호출하면 `403 {"detail":"consent_required"}`.
- [ ] 필수 동의 미완료 유저도 `POST /v2/consents`, `GET /v2/consents/documents`, `/v2/auth/*`는 정상 접근.
- [ ] 필수 동의 3종을 granted로 기록한 뒤에는 위 보호 엔드포인트가 정상 동작.
- [ ] 웹: 미동의 상태로 보호 API 호출 시 `/terms`로 이동, required 문서가 interactive로 뜨고, 동의 제출 후 원래 목적지로 진입.
- [ ] 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] 백엔드: `uv run --package acting-api pytest` 통과(신규 테스트 포함).
- [ ] openapi.json 재생성 + (변경 시) 웹 타입 재생성 반영.

## 하지 말 것 (스코프 제한)

- 모바일 앱 코드 변경 금지.
- 문서 본문의 플레이스홀더(`[운영자명]` 등) 치환 금지 — 별도 운영/법무 작업.
- `refresh` 응답에 `pending_consents` 추가하지 않음 — 403 핸들러로 충분.
- 선택(optional) 동의 타입/enum 확장하지 않음 — 현재 3종 전부 required.
- 새 REST 엔드포인트 신설하지 않음 — 기존 `GET /v2/consents/documents` 재사용.
- consent DB 스키마/마이그레이션 변경하지 않음 — 이미 완비.

## 미결 / 설계 판단 (승인 시 확인 요망)

1. **강제 범위 = 네 라우터 전체(읽기 포함).** → 문서 신규 발행 후 **기존 전체 유저**가 다음 행동 시 동의 게이트를 만나고, 동의 전엔 히스토리·리포트 조회도 불가. 법적으로 의도된 결과이나, "쓰기만 막기"로 좁힐 여지 있음. **기본안: 전체 차단.**
2. **플레이스홀더 잔존 문서를 dev에 그대로 발행.** dev 검증엔 무방, 실배포 전 치환 필요(README에 이미 명시).
3. **seed 실패는 비치명적.** 문서 발행 실패 시 게이트가 안 뜨는 대신 API는 정상 부팅(강제도 "발행된 필수 문서 없음 → pending 없음 → 통과"로 안전).
