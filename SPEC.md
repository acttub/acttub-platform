# SPEC: API 응답 모델 선언 및 계약 소스 승격

## 배경 / 목적

acting-api의 17개 엔드포인트 전부가 응답 스키마 선언 없이 dict를 반환한다. 그 결과:

- OpenAPI 스펙의 모든 2xx 응답 스키마가 빈 스키마(`{}`)로 나가고, Swagger `/docs`는 응답 예시를 전부 `"string"`으로 렌더링한다.
- 웹 생성 타입(`apps/web/src/lib/api/v2-schema.d.ts`)의 응답 타입이 전부 `unknown`이라, 프론트는 응답 계약을 `types.ts` 수제 정의(20여 개)로 유지하고 있다. 계약 소스가 코드·API.md·수제 타입 세 곳으로 갈라져 드리프트를 typecheck가 잡지 못한다.

이번 작업으로 응답 계약의 단일 소스를 `apps/api/spec/openapi.json`으로 승격한다.

## 설계

### 1. 백엔드 — Pydantic 응답 모델 선언 (문서화 전용)

- **선언 방식** (Codex 비판 ①·② 반영, 사용자 결정): 17개 전부 데코레이터의 `responses={<status>: {"model": <Model>}}`로 **문서화 전용** 선언한다. `response_model=`은 사용하지 않는다 — 런타임 검증·재직렬화가 없으므로 **응답 바이트가 100% 불변**이고, 5개 라우트(practice create/analyze, coach start/reply, reports create)가 `Response`를 직접 반환해 검증을 우회하는 비대칭도 없다.
- **계약 정직성은 CI가 강제**: 문서화 전용이므로 모델이 실제와 어긋나도 런타임엔 침묵한다. 이를 막기 위해 **계약 테스트**를 추가한다 — 기존 pytest 통합 플로우가 받는 실제 응답 본문을 각 선언 모델의 `TypeAdapter`(strict 필드 대조)로 검증한다. 멱등 replay 경로(저장된 `response_payload` 재반환)도 같은 모델로 검증한다.
- **모델 위치·네이밍**: 각 라우터 모듈 안에 정의 (`practice_sessions.py`, `uploads.py`, `consents.py`, `auth/router.py`, `coaching.py`, `reports.py`, health는 소재 모듈). 이름은 프론트 `types.ts` 수제 타입명을 따르되(`TokenPairResponse` 등), **내부 서비스 패키지(acting-summary/agent/report)의 스키마 클래스를 import 재사용하지 않는다** — 게이트웨이 전용 모델로 새로 정의한다 (Codex ③·④·⑨: 복제본 드리프트·`user_id` 유입·스키마 그래프 이름 충돌 차단). FastAPI 스키마 그래프 안에서 클래스명이 유일해야 component 키가 `"SceneSummary"` 그대로 생성된다.
- **가변 구조 필드** (사용자 결정, Codex ③ 반영): `SceneSummary`는 최상위 핵심 필드만 typed(`summary_id` 필수 + `summary`/`intent_alignment`/`key_moment`/`key_dimension` 선택) + `model_config = ConfigDict(extra="allow")`. **중첩 구조는 raw로 유지** — `observation: dict[str, Any] | None`, `anomalies: list[dict[str, Any]] | None`. 중첩 모델 필드 손실 위험 0, 현 프론트 타입과 동일 계약.
- **required 의미 정확화** (Codex ⑧): wire에 항상 존재하는 필드는 default 없이 required로 선언한다 (`CoachTurnResponse.done`·`reason`, `ReportRecord.turns` 등). 게이트웨이가 항상 넣는 필드에 default를 주면 생성 타입이 optional(`done?`)이 되어 프론트가 깨진다.
- **상태 코드별 처리** (Codex ⑩):
  - 204 라우트(`POST /v2/auth/logout`, `DELETE /v2/practice-sessions/{id}`)는 모델 없음.
  - `POST /v2/practice-sessions`·`POST /{id}/analyze`: **200과 202 모델 분리** — 202는 `{session_id, status}`만(`PracticeSessionAcceptedResponse`), 200은 `summary_id`를 **optional**로 포함(`PracticeSessionCreateResponse`) — 레거시 succeeded operation에 payload가 없으면 두 필드 fallback이 존재하므로 required로 하면 문서가 거짓이 된다.
  - `POST /v2/consents`·`POST /v2/uploads/intents`는 201에 선언.
- **reports 게이트웨이 모델** (Codex ④): `CreateReportResponse`·`ReportHistoryResponse`에 내부 envelope의 `user_id`를 포함하지 않는다 (기존 테스트가 부재를 검증).
- **오류 응답**: 이번 PR은 성공 응답만. 4xx/5xx `{"detail": string}` envelope 문서화는 후속.

### 2. 드리프트 가드 (Codex ⑤·⑥·⑦ 반영)

pytest 3종을 추가한다. 모두 `test_platform_v2.py`의 fake settings/store/client 주입 패턴을 사용해 secret 없는 CI에서 동작해야 한다 (`create_app()` 인자 없는 호출은 DATABASE_URL·JWT_SECRET·GEMINI_API_KEY를 요구하므로 금지):

1. **매트릭스 가드**: 기대 (method, path, status) 매트릭스를 테스트에 고정하고, OpenAPI의 각 항목이 매트릭스와 일치하며 `$ref`를 끝까지 resolve했을 때 빈/무제약 객체가 아닌 스키마를 갖는지 검사. (단순 "2xx 비어있지 않음" 검사는 202 누락·엉터리 한 필드 모델을 통과시킨다.)
2. **스펙 동등성**: live `app.openapi()` == `json.loads(spec/openapi.json)` — 모델만 바꾸고 스펙 재생성을 빠뜨리는 드리프트를 CI에서 차단.
3. **계약 테스트**: §1의 TypeAdapter 실응답 검증.

### 3. 스펙·웹 타입 재생성

1. 스펙 재생성 (apps/api/CLAUDE.md의 기존 명령, 단 fake settings 필요 시 테스트 픽스처와 동일 방식).
2. `pnpm --filter web generate:v2-schema`로 `v2-schema.d.ts` 재생성.

### 4. 프론트 — 수제 응답 타입 교체 (사용자 결정, Codex ⑧ 완화 반영)

`types.ts`의 수제 응답 타입을 `components["schemas"][...]` re-export로 교체한다. **export 이름은 전부 유지**하고 사용처 수정은 최소화하되, required/optional 의미가 정확해지면서 생기는 **소폭 사용처 수정은 허용**한다 (예: `practice-flow.tsx`의 `turns: unknown[]` 대입부). 파생 유니온(`PracticeSessionStatus`, `CoachAction` 등)은 생성 스키마 인덱싱으로 유도하되, 부적합하면 수제 유지 허용 (사유를 최종 보고에 기록). 생성 component 키가 기대 이름과 어긋나면 `paths` operation response 인덱싱으로 대체한다.

### 5. 문서 지위 정리 (사용자 결정)

- `apps/api/CLAUDE.md`의 계약 변경 절차에서 "응답 스키마는 스펙에 없으므로 API.md가 응답 계약의 소스" 문구를 "스펙(openapi.json)이 응답 계약의 소스"로 갱신한다.
- `API.md`는 사람용 설명 문서로 유지하고 응답 예시를 삭제하지 않는다.

## 완료 기준 체크리스트

- [ ] 본문이 있는 모든 2xx 응답(매트릭스 고정)이 OpenAPI 스펙에 `$ref` resolve 기준 구체적 스키마로 노출된다.
- [ ] Swagger `/docs`에서 응답 예시가 `"string"`이 아닌 실제 구조로 표시된다.
- [ ] `POST /v2/practice-sessions`·`/{id}/analyze`의 202 응답이 200과 별도 모델로 문서화된다.
- [ ] 가드 pytest 3종(매트릭스·스펙 동등성·계약)이 추가되어 통과한다.
- [ ] `apps/api/spec/openapi.json` 재생성 반영 (동등성 테스트가 증명).
- [ ] `v2-schema.d.ts` 재생성 + `types.ts` 응답 타입이 생성 타입 re-export로 교체 (export 이름 유지).
- [ ] 런타임 응답 바이트 불변 — 문서화 전용 선언이므로 라우터 런타임 경로 무변경, `cd apps/api && uv run pytest` 전체 통과 (기존 234개 + 신규).
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] `apps/api/CLAUDE.md` 계약 절차 문구 갱신.

## 하지 말 것 (스코프 제한)

- `response_model=` 사용 (런타임 검증·재직렬화 도입 금지 — 문서화 전용 결정 위반).
- 4xx/5xx 오류 응답 스키마 선언 (후속 PR).
- 라우터 비즈니스 로직·상태 코드·응답 내용·직렬화 경로의 변경. 런타임 응답 바이트는 완전 동일해야 한다.
- 내부 서비스 패키지(acting-summary/agent/report)의 스키마 클래스를 게이트웨이 응답 모델로 import 재사용.
- `API.md` 응답 예시 삭제·축소.
- `v2-schema.d.ts` 수동 편집.
- acting-agent / acting-summary / acting-report 내부 서비스 라우터 수정.
- 스코프 밖 리팩터링.

## Codex 최종 관문 처리 기록 (Phase 6, 2026-07-20)

- **코드 리뷰**: 지적 0건 — "응답 모델·실제 payload·OpenAPI 스펙·생성 TS 타입 사이의 불일치 없음".
- **적대적 리뷰 [high] 기각** — "legacy cache의 `200 {}` 무검증 replay": 사실이나 이번 변경이 만든 위험이 아닌 기존 동작이고, 권고안(cached payload 런타임 strict 검증 + DB 감사/backfill)은 문서화 전용 결정·"런타임 경로 무변경" 스코프 제한과 충돌. 미결 사항에 후속 과제로 기록.
- **적대적 리뷰 [medium] 수용** — "analysis replay 계약 테스트 순환 검증": 실제 `AnalysisWorker` 완료 경로를 통과시키도록 테스트 보강.

## Codex 설계 비판 처리 기록 (2026-07-20)

- **수용 ①②(blocker/major)**: 검증형 response_model 폐기 → 전 라우트 문서화 전용 + CI 계약 테스트로 전환 (사용자 결정).
- **수용 ③**: SceneSummary 중첩(observation/anomalies)은 raw 유지, 게이트웨이 전용 모델 정의 (사용자 결정).
- **수용 ④⑤⑥⑦⑧⑨⑩**: user_id 유입 금지, 매트릭스 가드·스펙 동등성 테스트·fake settings 패턴, required 의미 정확화 + 프론트 소폭 수정 허용, 이름 충돌 회피, 200/202 모델 분리 (일괄 반영, 사용자 승인).
- **기각 (부분)**: ②의 "저장·반환 전 런타임 TypeAdapter 검증" 제안 — 런타임 경로 변경이라 문서화 전용 결정과 충돌, 검증은 CI 계약 테스트로 대체.

## 미결 사항

- 오류 응답 envelope(`{"detail": string}`)의 스펙 문서화 — 후속 PR.
- 멱등 replay의 legacy cache 방어 (후속 PR): `external_operations.response_payload`가 null/구형인 succeeded row는 `200 {}` 또는 구형 payload를 무검증 반환한다. operation kind별 모델로 cached payload를 반환 전 검증할지, 기존 row 감사·backfill할지는 별도 결정 필요 (이번 PR은 런타임 무변경 원칙으로 제외).

## 검증 명령

- 백엔드: `cd apps/api && uv run pytest`
- 스펙 재생성: `cd apps/api && uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"` (env 요구 시 계약 테스트와 동일한 fake settings 경로 사용)
- 웹: `pnpm --filter web generate:v2-schema` → `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 수동 확인: dev 서버 기동 후 `http://localhost:8000/docs`에서 응답 스키마 표시 확인.
