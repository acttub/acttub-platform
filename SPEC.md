# SPEC: API 응답 모델 선언 및 계약 소스 승격

## 배경 / 목적

acting-api의 17개 엔드포인트 전부가 `response_model` 선언 없이 dict를 반환한다. 그 결과:

- OpenAPI 스펙의 모든 2xx 응답 스키마가 빈 스키마(`{}`)로 나가고, Swagger `/docs`는 응답 예시를 전부 `"string"`으로 렌더링한다.
- 웹 생성 타입(`apps/web/src/lib/api/v2-schema.d.ts`)의 응답 타입이 전부 `unknown`이라, 프론트는 응답 계약을 `types.ts` 수제 정의(20여 개)로 유지하고 있다. 계약 소스가 코드·API.md·수제 타입 세 곳으로 갈라져 드리프트를 typecheck가 잡지 못한다.

이번 작업으로 응답 계약의 단일 소스를 `apps/api/spec/openapi.json`으로 승격한다.

## 설계

### 1. 백엔드 — Pydantic 응답 모델 선언

- **선언 방식**: 데코레이터의 `response_model=`로 통일한다. (반환 타입 어노테이션 방식은 `JSONResponse`를 직접 반환하는 라우트와 충돌하므로 채택하지 않는다.)
- **모델 위치·네이밍**: 기존 요청 모델 관례를 따라 각 라우터 모듈 안에 정의한다 (`practice_sessions.py`, `uploads.py`, `consents.py`, `auth/router.py`, `coaching.py`, `reports.py`, health는 소재 모듈). 네이밍은 프론트 `types.ts`의 기존 수제 타입명을 그대로 쓴다 (`TokenPairResponse`, `UploadIntentResponse`, `CoachTurnResponse` 등) — 생성 스키마명과 프론트 export명이 자연스럽게 일치한다.
- **가변 구조 필드** (사용자 결정 ①): Gemini 산출물인 `SceneSummary`(`observation`, `anomalies` 등)는 핵심 필드만 typed로 선언하고 `model_config = ConfigDict(extra="allow")`로 추가 필드를 통과시킨다. 현 프론트 타입(`& Record<string, unknown>`)과 동일한 계약이므로 동작 변화가 없다.
- **응답 필드 손실 금지**: `response_model`은 선언 밖 필드를 잘라내므로, 각 모델은 현재 실제 응답(라우터 코드 + API.md + 기존 pytest)과 필드 단위로 대조해 정의한다. 기존 pytest 234개가 응답 본문을 검증하므로 누락 시 실패한다.
- **상태 코드별 처리**:
  - 204 라우트(`POST /v2/auth/logout`, `DELETE /v2/practice-sessions/{id}`)는 본문이 없으므로 모델을 선언하지 않는다.
  - `POST /v2/practice-sessions`·`POST /{id}/analyze`는 멱등 상태에 따라 200/202를 `JSONResponse`로 직접 반환한다. 두 코드 모두 같은 세션 payload 형태이므로 `responses={202: {...}}`로 202도 문서화한다. `JSONResponse` 직접 반환 경로는 FastAPI가 런타임 검증을 건너뛴다는 점을 인지한다 (문서화 목적으로는 충분).
- **오류 응답** (사용자 결정 ③): 이번 PR은 성공 응답만. 4xx/5xx `{"detail": string}` envelope 문서화는 후속으로 미룬다.

### 2. 드리프트 가드 (사용자 결정 ⑤)

pytest 1개 추가: `create_app().openapi()`를 순회하며 **본문이 있는 모든 2xx 응답**이 비어 있지 않은 스키마를 갖는지 검사한다 (204 등 본문 없는 응답은 면제). 앞으로 응답 모델 없는 라우트가 들어오면 CI에서 실패한다.

### 3. 스펙·웹 타입 재생성

1. `apps/api`에서 스펙 재생성 (apps/api/CLAUDE.md의 기존 명령).
2. `pnpm --filter web generate:v2-schema`로 `v2-schema.d.ts` 재생성.

### 4. 프론트 — 수제 응답 타입 교체 (사용자 결정 ②)

`types.ts`의 수제 응답 타입을 요청 타입과 같은 방식(`components["schemas"][...]` re-export)으로 교체한다. **export 이름은 전부 유지**해 사용처 diff를 0으로 만든다. 파생 타입(`PracticeSessionStatus`, `CoachAction` 등 유니온)은 생성 스키마에서 인덱싱으로 유도하되, 생성 결과가 유도에 부적합하면 수제 유지를 허용한다 (사유를 최종 보고에 기록).

### 5. 문서 지위 정리 (사용자 결정 ④)

- `apps/api/CLAUDE.md`의 계약 변경 절차에서 "응답 스키마는 스펙에 없으므로 API.md가 응답 계약의 소스" 문구를 "스펙(openapi.json)이 응답 계약의 소스"로 갱신한다.
- `API.md`는 사람용 설명 문서(예시·처리 규칙 중심)로 유지하고 응답 예시를 삭제하지 않는다.

## 완료 기준 체크리스트

- [ ] 본문이 있는 모든 2xx 응답(17개 엔드포인트)이 OpenAPI 스펙에 구체적 스키마로 노출된다 (빈 `{}` 없음).
- [ ] Swagger `/docs`에서 응답 예시가 `"string"`이 아닌 실제 구조로 표시된다.
- [ ] `POST /v2/practice-sessions`·`/{id}/analyze`의 202 응답이 스펙에 문서화된다.
- [ ] 드리프트 가드 pytest가 추가되어 통과한다.
- [ ] `apps/api/spec/openapi.json` 재생성 반영.
- [ ] `v2-schema.d.ts` 재생성 + `types.ts` 응답 타입이 생성 타입 re-export로 교체 (export 이름 유지, 사용처 수정 0 목표).
- [ ] 기존 응답과 필드 단위 동일 — `cd apps/api && uv run pytest` 전체 통과 (기존 234개 + 신규).
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과.
- [ ] `apps/api/CLAUDE.md` 계약 절차 문구 갱신.

## 하지 말 것 (스코프 제한)

- 4xx/5xx 오류 응답 스키마 선언 (후속 PR).
- 라우터 비즈니스 로직·상태 코드·응답 내용의 변경. 이 작업은 **문서화·타입화**이며 런타임 응답 바이트는 동일해야 한다.
- `API.md` 응답 예시 삭제·축소.
- `v2-schema.d.ts` 수동 편집 (재생성만 허용).
- acting-agent / acting-summary / acting-report 내부 서비스 라우터 수정 — 대상은 acting-api가 노출하는 `/v2/*` + `/health`뿐.
- 스코프 밖 리팩터링 (기존 dict 조립 헬퍼를 모델 반환으로 바꾸는 등).

## 미결 사항

- 오류 응답 envelope(`{"detail": string}`)의 스펙 문서화 — 후속 PR.
- `SceneSummary`의 core 필드 확정 범위: 현 프론트 수제 타입 기준(`summary_id` 필수 + `observation`/`summary`/`intent_alignment`/`key_moment`/`key_dimension`/`anomalies` 선택)으로 시작하되, 구현 중 라우터·acting-summary 산출물과 대조해 조정 가능.

## 검증 명령

- 백엔드: `cd apps/api && uv run pytest`
- 스펙 재생성: `cd apps/api && uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"`
- 웹: `pnpm --filter web generate:v2-schema` → `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 수동 확인: dev 서버 기동 후 `http://localhost:8000/docs`에서 응답 스키마 표시 확인.
