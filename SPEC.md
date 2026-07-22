# SPEC — 회원가입 시 동의 수집 활성화 (발행 자동화 + 서버 강제 + 클라이언트 복구)

브랜치: `feat/signup-consent` (base: `dev` = 5155dc0)
범위: 프론트엔드(web) · 백엔드 · DB(데이터/seed) · **모바일(포함)**.

## 배경 / 목적

동의 수집 플로우는 이미 **전 계층에 구현**돼 있다:

- **DB 스키마**: `consent_documents`(unique(type,version)), `user_consents`(append-only 이벤트 로그) — 마이그레이션 0001. 스키마 변경 불필요.
- **백엔드**: `POST /v2/auth/login`이 미동의 필수 문서를 `pending_consents`로 반환(`auth/router.py:84,120`). `POST /v2/consents` 기록, `GET /v2/consents/documents` 목록.
- **웹**: 로그인 후 `pending_consents`가 있으면 `/terms`로 보내고, `terms-gate.tsx`가 필수 체크·제출·부분실패 재시도·403/404 처리까지 완비. `use-require-auth.ts` 가드.
- **모바일**: `_layout.tsx` 게이트가 `pendingConsents`를 보고 `/consent` 화면으로 라우팅.

**그런데 동작하지 않는다.** 이유:

1. **문서가 DB에 발행되지 않는다.** `publish_consent_document`는 수동 CLI로만 호출 → `pending_consents`가 항상 비어 게이트가 안 뜬다.
2. **서버 강제가 없다.** 동의 안 해도 보호 엔드포인트 접근 가능(advisory-only). 클라이언트 게이트는 로그인 응답/로컬 상태에 의존해, 저장소 소실·타기기·refresh(로그인 아님) 경로에서 우회된다.

목적: (A) 문서를 앱 시작 시 자동 발행, (B) 필수 동의 전 보호 엔드포인트를 서버에서 차단, (C) 웹·모바일이 그 차단(403)을 받아 동의 게이트를 띄우고 서버에서 유저별 pending을 조회해 복구.

## 핵심 설계 원칙 — dev/prod 동일 구성 (env 플래그 없음)

강제·발행을 **환경변수 플래그로 분기하지 않는다.** dev와 prod는 완전히 동일한 코드·설정으로 동작한다. 환경별 차이는 **오직 데이터(각 DB에 발행된 문서)**에서 자연 발생한다:

- 강제 로직은 "발행된 필수 문서가 있는데 유저가 동의 안 함 → 403"이다.
- **발행된 문서가 없는 DB에서는 pending이 없어 자동으로 통과**한다(fail-open by data).
- 따라서 코드·설정은 dev==prod, "강제가 실제로 켜지는가"는 그 DB에 문서가 발행됐는지에만 좌우된다.

롤아웃 안전은 플래그가 아니라 **배포 순서**로 통제한다(하단 "운영 노트" 참조).

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
- **config**: `GatewaySettings`에 `consent_docs_dir: Path | None` 추가. env `CONSENT_DOCS_DIR`, 기본값 `Path(config.py).resolve().parents[2] / "consent_docs"` (= acting-api 루트, `.env` 경로와 동일 패턴). *(env는 "경로 지정"일 뿐 동작 분기가 아님 — parity 위반 아님.)*
- **store 헬퍼**: `get_consent_document_by_type_version(type, version) -> ConsentDocument | None` 추가.
- **seed 함수**: `acting_api/consents.py: seed_consent_documents(store, docs_dir) -> int` (발행 건수 반환).
  - **선검증-후발행**(부분 커밋 방지): 매니페스트와 **모든 파일 본문을 먼저 읽어 검증**한 뒤 발행 단계로 넘어간다. 파일 누락/파싱 실패 시 → error 로그 후 **아무것도 발행하지 않고** 0 반환.
  - **idempotency + 불일치 감지**: 각 항목에 대해 (type,version)이 이미 있으면 skip하되, **기존 row의 title/body/required가 매니페스트와 다르면 WARNING 로그**(조용한 skip 금지 — 수정본은 version을 올려 재발행하라는 워크플로우 강제). 없으면 `publish_consent_document(...)`.
  - **경합 처리 축소**: 동시 부팅 경합으로 인한 `IntegrityError`는 **해당 unique constraint(`uq_consent_documents_type_version`) 위반일 때만** skip, 그 외 IntegrityError는 재발생시킴(무관 오류 은폐 금지).
  - `docs_dir`/`manifest.json` 자체가 없으면 warning 후 0 반환.
- **lifespan 배선**: `app.py`의 `lifespan` startup(`yield` 이전)에서 `run_in_threadpool(seed_consent_documents, store, gateway_settings.consent_docs_dir)` 호출. **try/except로 감싸 실패해도 부팅 계속**(로그만). *(문서 미발행 시 강제는 "pending 없음 → 통과"로 안전.)*

### B. 서버측 강제 (enforcement) — 백엔드 (항상 켜짐)

- **pending 로직 중앙화**: `auth/router.py:_pending_consents`의 판정을 재사용 함수로 추출.
  - store 헬퍼 `has_pending_required_consents(user_id) -> bool`: 최신 필수 문서 중 유저의 현재 action이 `granted`가 아닌 것이 하나라도 있으면 True.
  - `pending_required_documents(store, user_id) -> list[ConsentDocument]`: pending 문서 목록(‌로그인 응답·GET /pending·`_pending_consents`가 공유).
- **게이트 의존성**: `auth/dependencies.py`에 `build_consent_gate_dependency(rate_limited_user, store)` → `consented_user`.
  ```python
  async def consented_user(user = Depends(rate_limited_user)):
      if await run_in_threadpool(store.has_pending_required_consents, user.id):
          raise HTTPException(status_code=403, detail="consent_required")
      return user
  ```
- **배선 (app.py만 수정)**: `consented_user`를 만들어 **uploads · practice · coaching · reports** 라우터의 `rate_limited_user=` 인자로 전달. `consented_user`가 내부적으로 `rate_limited_user`를 depend → **네 라우터 파일 무변경**. (Codex 확인: 중첩 의존성이라 rate limit 이중 실행 없음.)
  - **면제(그대로 `rate_limited_user`)**: `consents`(동의 기록·조회·pending), `auth`(logout).
- 오류 형식은 FastAPI 표준 `{"detail": "consent_required"}` 유지.

### C. 유저별 pending 조회 엔드포인트 (웹·모바일 공용) — 백엔드

- **`GET /v2/consents/pending`** 신설 (consents 라우터, 인증 `rate_limited_user`, **강제 면제**). 반환 `ConsentDocumentsResponse` = 해당 유저의 pending 필수 문서(`pending_required_documents` 재사용).
- 계약 변경: openapi 재생성 + 웹 타입 재생성 절차 수행.

### D. 웹 프론트엔드 — 403 처리 + 게이트 서버소싱

- **중앙 403 처리**: `lib/api/v2/client.ts`(`apiFetch`)에서 `status 403 && code === "consent_required"`이면 세션 이벤트 `consent-required` emit(`lib/auth/session-events.ts`에 이벤트 추가).
- **전역 리스너**: 앱 루트에 마운트되는 client 컴포넌트가 구독 → `router.replace('/terms?next=<현재경로>')`. **single-flight dedupe**(동시 다발 403이 next를 덮지 않게 1회만), **이미 `/terms`면 무시**(루프 차단).
- **게이트 서버소싱** (`terms-gate.tsx` `loadDocuments` 수정):
  - localStorage pending 있으면 → 기존대로 interactive(pending) 모드(로그인 해피패스 유지).
  - 없고 로그인 상태면 → **`GET /v2/consents/pending`** 조회 → 비어있지 않으면 그 문서로 interactive 모드(유저별 정확). *(query flag 신뢰 제거 — 서버가 권위.)*
  - 위 둘 다 아니면 → info(read-only, `GET /documents`) 모드.
  - 제출 성공 경로는 기존과 동일.

### E. 모바일 (apps/mobile) — 403 처리 + pending 조회

기존 게이트(`_layout.tsx`가 `pendingConsents.length>0`이면 `/consent`로 라우팅)를 재사용한다. 인터셉터가 pending만 채우면 자동 이동.

- **`lib/api.ts` `request()`**(274줄 throw 지점): 401 refresh 분기 다음에 **403 `consent_required` 감지** 추가. body는 1회 소비 주의(`res.json()`로 detail 확인 후 재사용, `friendlyError` 재호출 금지). 감지 시 모듈 pub/sub `emitConsentRequired()` emit 후 에러 throw.
- **`lib/api.ts`**: `api.pendingConsents()` 추가 → `GET /v2/consents/pending`(`auth:true`). `ApiError`에 `detail`/`code` 필드(또는 `ConsentRequiredError` 서브클래스) 추가해 코드 구분.
- **`lib/token-store.ts` 패턴 복제**: `onTokensCleared`(pub/sub)와 동형으로 `onConsentRequired(fn)` 신설.
- **`lib/auth.tsx`**: `onConsentRequired` 구독 → `api.pendingConsents()`로 목록 fetch 후 `setPendingConsents(docs)`. 그러면 `_layout.tsx` 게이트가 자동으로 `/consent`로 이동.
- **`app/consent.tsx`**: 진입 시 `pendingConsents`가 비어 있으면 `GET /v2/consents/pending`로도 채우도록 보강(로그인 응답 유래가 아닌 403 유입 케이스 대응).
- Expo v54 관례 준수(`apps/mobile/AGENTS.md`) — 변경은 대부분 순수 TS(fetch·pub/sub·context)라 Expo API 의존 낮음.

## 완료 기준 체크리스트

- [ ] `consent_docs/manifest.json` 존재, 3종 매핑 정확.
- [ ] 빈 consent DB로 API 부팅 시 3종 자동 발행, `GET /v2/consents/documents` 3건.
- [ ] 재부팅해도 중복 발행 0, 여전히 3건. 파일 누락 시 아무것도 발행 안 하고 경고, 부팅은 계속.
- [ ] (type,version) 동일하나 본문/required 다르면 경고 로그.
- [ ] 미동의 유저가 uploads·practice·coaching·reports 호출 → `403 {"detail":"consent_required"}`.
- [ ] 미동의 유저도 `POST /v2/consents`, `GET /v2/consents/documents`, `GET /v2/consents/pending`, `/v2/auth/*` 정상.
- [ ] `GET /v2/consents/pending`이 그 유저의 미동의 필수 문서만 반환(전부 granted면 빈 목록).
- [ ] 3종 granted 후 보호 엔드포인트 정상.
- [ ] 웹: 미동의로 보호 API 호출 → `/terms` 이동, `/pending` 조회로 required 문서 interactive 표시, 제출 후 원래 목적지 진입. 동시 다발 403에도 리다이렉트 1회.
- [ ] 모바일: 미동의로 보호 API 호출 → `/consent` 이동, `/pending`으로 문서 채워 렌더, 제출 후 진입.
- [ ] 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] 모바일: `pnpm --filter mobile lint`(있으면) · typecheck 통과.
- [ ] 백엔드: `uv run --package acting-api pytest` 통과(신규 테스트 포함).
- [ ] openapi.json 재생성 + 웹 타입 재생성 반영(`GET /v2/consents/pending` 포함).

## 하지 말 것 (스코프 제한)

- 문서 본문 placeholder(`[운영자명]` 등) 치환 금지 — 별도 운영/법무 작업.
- `refresh` 응답에 `pending_consents` 추가하지 않음 — 403+`/pending`으로 충분.
- 선택(optional) 동의 타입/enum 확장 안 함 — 현재 3종 전부 required.
- consent DB 스키마/마이그레이션 변경 안 함 — 이미 완비.
- **env 플래그로 강제/발행을 분기하지 않음** — dev==prod.
- consent 이벤트 순서 결정성(occurred_at 앱시계) 개선은 이 스코프 밖(하단 참조).
- 모바일 최소버전 강제(force-update)는 이 스코프 밖(운영 과제).

## 미결 / 운영 노트 (env 플래그를 대체하는 배포 순서 통제)

1. **prod 배포 전 문안 확정**: placeholder를 실제 값으로 치환한 뒤 prod에 배포(‌prod DB는 별도라 깨끗한 v1을 받음). 문안 수정 시 version을 올려 재발행.
2. **클라이언트 선/동시 배포**: 403 `consent_required`를 처리하는 웹·모바일 신버전을 강제가 도는 서버와 함께 릴리스.
3. **모바일 구버전 한계**: 이미 설치된 옛 앱은 업데이트 전까지 막힘(네이티브 앱 본질). 최소버전 강제는 추후 별도 과제.
4. **기존 유저 재동의**: 문서 발행 후 모든 기존 유저는 다음 행동 시 게이트를 만남 — 의도된 결과.

## Codex 설계 비판 반영 요약

- 반영: 선검증-후발행(부분 커밋 방지), 불일치 경고, IntegrityError 범위 축소, `GET /v2/consents/pending` 신설(query flag·전체 재동의·전면 localStorage 의존 제거), 리다이렉트 single-flight·`/terms` 무시.
- 기각(스코프 밖): consent 이벤트 동시성 순서(기존 append-log 설계 속성, 회원가입은 단일기기·순차), wheel 패키징 경로(소스 레이아웃 배포 + `CONSENT_DOCS_DIR` override로 충분).
- 확인됨: enforcement 배선 트릭 정상(rate limit 이중 없음), 면제 범위 정확, gate 자체 fetch 루프 없음.
