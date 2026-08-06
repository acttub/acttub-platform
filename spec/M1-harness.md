# M1 — 계약 동등성 하네스

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M1 사이클에만 적용된다.**
소스 참조는 `파일:심볼` 형식이다(`/SPEC.md` §12). 경로 기준도 거기에 있다.

> **2026-08-06 개정.** M0 종료와 M1 착수 사이에 `SOMA-302`(AI 3개 층 교체)가 dev에 들어왔다.
> 초판이 근거로 삼은 사실 중 상당수가 바뀌어(`SceneSummary` 소멸, unknown key 허용 7→5,
> `POST /v2/coach/confirm` 신설, 오류 detail 표기 변경) 기대값 소스를 다시 뽑았다.
> 바뀐 항목은 본문에 ⚠로 표시했다.

## 목적

빅뱅 전환이므로 **"기존과 똑같이 동작하는가"를 판정할 수단이 이것뿐이다.** M2 이후 모든 사이클의 완료 판정이 여기에 의존하므로 실제 이식보다 먼저 세운다.

M1 시점에 Java 쪽은 `/health`뿐이다. 따라서 **이 사이클의 검증은 "하네스가 옳은가"를 증명하는 것**이며, 방법은 §완료 기준에 정의한다.

## 위치·언어

- Python. `tools/contract-harness/` 아래.
- 기존 pytest 자산(픽스처·골든 데이터·토큰 발급)을 재사용한다.
- **M6에서 폐기한다**(검증 항목을 Java 테스트로 이관한 뒤). 영구 자산이 아니므로 과도한 추상화를 만들지 않는다.

## 아키텍처 — 독립 스키마 2개 + ID 정규화

### 왜 DB를 공유하면 안 되는가

두 백엔드를 같은 mutable 스키마에 붙이면, **먼저 실행한 쪽이 행을 만들고 나중 쪽은 생성 경로 대신 replay·충돌 경로를 탄다**(`db/store.py:PostgresStore.create_practice_session_with_analysis_operation`의 멱등키, `.create_user_with_identity` 등). 실제 구현 동등성을 비교하지 못한다.

반대로 아무 조치 없이 스키마를 분리하면 user·consent document·upload intent·practice session·summary의 UUID가 전부 달라져 diff가 무의미해지고, Python이 발급한 JWT의 `sub`가 상대 DB의 유저와 맞지 않는다(`auth/dependencies.py:build_current_user_dependency`).

### 채택 방식

1. **같은 seed를 복제한 독립 스키마 2개.** `tests/db_test_support.py`의 `postgres_schema` 픽스처가 쓰는 `acting_test_<uuid>` 패턴을 빌려 스키마를 두 벌 만들고 동일한 시드를 넣는다
2. **시드가 만드는 ID는 고정한다** — 유저 UUID, 약관 문서 UUID. 이러면 토큰 하나가 양쪽에서 유효하다
3. **API가 런타임에 생성하는 ID는 symbolic으로 정규화한다.** `$practice_session_1`, `$coach_session_1` 같은 심볼로 치환해 비교하고, **후속 요청에는 각 백엔드가 실제로 반환한 ID를 쓴다.** 두 백엔드의 시나리오가 각자의 ID 공간에서 독립적으로 진행된다
4. 토큰은 **Python이 발급하고 양쪽이 소비**하는 단방향. `auth/jwt.py:JwtService._decode`가 헤더를 `{"alg":"HS256","typ":"JWT"}`와 정확히 비교하므로 Java 라이브러리가 `kid`를 자동 추가하면 깨진다. `exp <= now`는 배타적 만료
   - **payload 키 정렬은 요구하지 않는다.** Python 디코더는 `json.loads`라 순서에 무관하다. M2가 Java 발급 토큰을 Python이 검증하는 방향까지 다룬다

### 3단 비교

| 층 | 대상 | 방법 |
|---|---|---|
| **L1 스키마** | 전 응답 | `openapi.json` 컴포넌트로 strict 검증. 응답 컴포넌트 26개가 **전부** `additionalProperties: false`라 필드 과부족이 즉시 잡힌다 |
| **L2 정규화 diff** | 전 응답 | 마스킹·symbolic 치환 후 JSON 구조 비교. **키 존재 여부까지** 비교 |
| **L3 바이트 동등** | 멱등 replay | **백엔드 간이 아니라 각 백엔드의 최초 응답 ↔ 자체 replay** |

**L3를 백엔드 간으로 잡으면 안 된다** — ID가 다르므로 애초에 바이트가 같을 수 없다. 검증하려는 계약은 "같은 요청을 두 번 보내면 바이트가 같다"(`sync_operations.py:_json_response`의 canonical 인코딩)이므로, 각 백엔드 안에서 성립하면 된다.

**L3 대상** — `tests/test_response_contracts.py:test_declared_response_models_validate_real_success_payloads_and_replays`가 `.content ==`로 바이트 동등을 요구하는 지점 전부:

| 엔드포인트 | 비고 |
|---|---|
| `POST /v2/practice-sessions` | 202 accepted replay, succeeded replay 두 경로 모두 |
| `POST /v2/coach/start` | |
| `POST /v2/coach/reply` | |
| `POST /v2/reports` | 응답 모델이 `PracticeReport`로 바뀌었다 (⚠ 구 `CreateReportResponse` 소멸) |

⚠ **초판과 달라진 두 가지**:
- `POST /v2/practice-sessions/{id}/analyze`는 이제 **바이트 동등 단언이 없다**(형상 검증만 남았다). 멱등 계약 자체는 유효하므로 **하네스는 L3 대상으로 유지하되, 기존 테스트가 근거가 아님을 기록한다**
- `POST /v2/coach/confirm`은 **신규인데 replay 테스트가 아예 없다.** `X-Request-Id`를 받는 sync operation이므로 L3 대상에 넣고, **하네스가 이 공백을 메운다**

⚠ **`SceneSummary` 예외 조항은 삭제됐다.** 초판은 이 컴포넌트만 `additionalProperties: true`라 "스키마가 아니라 값 동일성으로 비교"하라고 했으나, `SOMA-302`가 스키마에서 제거했다. 현재 응답 컴포넌트에 열린 것은 FastAPI가 만드는 `HTTPValidationError`뿐이다.

### 마스킹 대상

| 값 | 출처 |
|---|---|
| API 생성 UUID 전반 | symbolic 치환으로 처리(위 3번) |
| `access_token` / `refresh_token` | jti·iat·exp가 매번 다름 |
| `playback_url` / `upload_url` | presign 서명 |
| `created_at`/`updated_at`/`expires_at`/`occurred_at`/`published_at` | 시계 |
| `HealthResponse.commit` | `app.py:create_app`의 환경변수 |

마스킹은 **값만** 지우고 **키와 타입은 검증**한다. `null`인지 문자열인지가 계약이다.

### LLM 스텁 — ⚠ 봉합선이 2개에서 **4개**로, 공급자가 1개에서 **2개**로 늘었다

초판은 "실제 Gemini 호출 3곳, 주입점은 `create_app(client=...)` 하나"였다. `SOMA-302` 이후 **공급자가 둘로 갈라졌다.**

| 층 | 공급자 | 호출부 | 주입점 (`app.py:create_app`) |
|---|---|---|---|
| 영상 분석 (`acting-summary`) | **Gemini** — Files API 업로드 → 폴링 → `generate_content` | `acting-summary/summarizer.py:summarize` | `client=` (하위) / `analyzer=` (상위) |
| 코치 (`acting-agent`) | **OpenAI** — `POST /v1/responses` | `acting-agent/engine.py:_generate_validated` | `coach_generate=` |
| 리포트 (`acting-report`) | **OpenAI** — 같은 클라이언트 | `acting-report/engine.py` | `report_generate=` |

공용 클라이언트는 신규 패키지 `acting-llm`의 `acting_llm/openai_client.py:generate_text`이고, 전사용 `:transcribe_audio`도 같은 패키지에 있다.

1. **동기 경로(coach/report)**: 이제 `generate_content`가 아니라 **`generate_text` 콜러블 레벨**에서 자른다 — `create_app(coach_generate=..., report_generate=...)`. `tests/api_test_support.py`의 골든 데이터를 **JSON 파일로 떠서 양쪽이 같은 파일을 읽게** 한다. 호출 순서가 곧 계약이므로 큐 순서를 고정한다
   - ⚠ 대상이 늘었다: `COACH_QUESTION`·`COACH_FOLLOWUP`·**`COACH_COMPLETE`(신규)**·`REPORT`, 그리고 관찰 팩 계열인 `SUMMARY`·`AGENT_SUMMARY`·**`ANALYSIS_HANDOFF`(신규)**
   - `REPORT`의 타입이 `AnalysisReport`로 바뀌었다(구 `ActingReport` 소멸)
   - `generate_text`는 `(text, TokenUsage)` 튜플을 돌려준다 — 스텁도 같은 형태여야 한다
2. **비동기 경로(분석 워커)**: **`analyzer` 레벨**(`create_app(analyzer=...)`)로 자른다. 워커는 백그라운드가 아니라 **`run_once()` 동기 훅**으로 구동한다(`analysis_worker.py:AnalysisWorker.run_once`). Java에도 동등 훅이 필요하다 — M4 SPEC에 반영됨

**하네스는 네 주입점을 모두 막아야 한다.** 하나라도 열려 있으면 네트워크를 타서 비결정이 되고 CI에서 깨진다.

## 기대값 소스

**숫자를 하드코딩하지 않는다**(`/SPEC.md` §6-2). 아래는 전부 **소스/OpenAPI에서 생성한 inventory**로 만들고, 집합 동등성으로 판정한다.

**이 원칙이 왜 절대적인가**: 초판은 "요청 바디 16개 중 7개가 unknown key 허용", "`default` 0개", "`anyOf [T,null]` 86곳"을 본문에 박아 뒀다. 넉 달 만에 각각 17개 중 5개 / 9개 / 97곳이 됐다. **박아 둔 숫자는 전부 틀렸고, 그것을 근거로 이식했다면 조용히 잘못된 구현이 나왔다.**

### ① 성공 응답 형상

`tests/test_response_contracts.py:SUCCESS_RESPONSE_MODELS`와 `:RESPONSE_COMPONENT_SHAPES`를 기계 판독 가능한 fixture로 추출한다. 원본 테스트 파일은 건드리지 않는다.

### ② 오류 계약

`openapi.json`에 없다(`/SPEC.md` §6-2). 소스에서 `(method, path, 조건) → (status, detail)`을 추출한다.

주의:
- 공백 포함 문장과 snake_case가 섞여 있다
- **같은 상태코드에 두 표기가 공존한다** — 404에 `practice session not found`와 `practice_session_not_found`가 둘 다, 409에 `report already exists`와 `report already exists for practice session`이 둘 다 있다. 라우터별로 정확히 갈라야 한다
- 422 validation만 `detail`이 배열이다
- ⚠ 초판이 "멀티라인이라 단순 grep에 안 잡힌다"고 예시한 `upload_intent_not_finalized_or_already_used`는 **더 이상 없다.** 현재는 `upload_intent_not_finalized`·`upload_not_found`로 갈렸다. 멀티라인 함정 자체는 남아 있으므로 **AST 파싱으로 추출**한다(정규식 금지)

### ③ 멱등 전이표

`tests/test_platform_v2.py:test_practice_session_running_succeeded_failed_and_fingerprint_branches` + `apps/api/API.md`. 단 API.md는 드리프트했으므로(`/SPEC.md` §9) 소스를 우선한다.

### ④ 조건부 라우트 — 별도 프로파일

admin 2개(`/admin/stats`, `/admin/sessions`)는 `ADMIN_OPS_TOKEN`이 있을 때만 등록된다(`app.py:create_app`, `admin.py:build_router`). **committed `openapi.json`에 아예 없다.**

→ `ADMIN_OPS_TOKEN`을 설정한 상태의 **별도 OpenAPI snapshot**을 만들고, admin 인증(토큰 없음 → 401)·nullable·presign fallback을 별도 시나리오로 둔다.

## 시나리오 — 전 영역 실행

`tests/test_response_contracts.py`의 전 플로우 시나리오가 좋은 대본이지만 **41개 operation 중 20개만 실행한다.** 나머지 21개는 응답 스키마 선언만 맞고 실제 조회 필터·커서·익명 별칭·권한이 틀린 구현도 통과할 수 있다.

실행하지 않는 21개(2026-08-06 실측):

| 영역 | 개수 | 내용 |
|---|---|---|
| 커뮤니티 | 16 | `posts`·`comments`·`likes`·`blocks`·`reports`·`categories` 전부 |
| 프로필 | 2 | `GET`/`PATCH /v2/me` |
| admissions | 2 | 공개 조회 2개 |
| 동의 | 1 | `GET /v2/consents/pending` |

| 시나리오 | 내용 |
|---|---|
| **메인 플로우** | 기존 대본 번역 — 로그인 → 약관 → 업로드 → complete → 세션(202) → 워커 → 재분석 → 코치(start·reply·**confirm**) → 리포트 → 이력·상세 → 삭제 → 로그아웃 |
| **커뮤니티** | 16개 경로 전부. 목록 커서(글 DESC / 댓글 ASC), 익명 별칭 번호, 차단 필터, 좋아요 카운트, 신고 중복, 조회수 증가 시점 |
| **프로필** | `/v2/me` GET·PATCH. nickname 정규화 |
| **admissions** | 공개 조회 2개 |
| **동의** | `GET /v2/consents/pending` |
| **admin** (별도 프로파일) | 토큰 있음/없음, presign fallback |
| **상태코드** | `tests/test_platform_v2.py`의 413/415·complete 멱등·소유권 404·error_code 파라미터화 |

### 게이트 둘을 셋업에서 처리

- **동의 게이트**(`auth/dependencies.py:build_current_user_dependency`): 미동의 시 전부 403. `POST /v2/consents` 선행. 약관 문서 UUID를 시드에서 고정하므로 양쪽이 같은 문서를 본다
- **레이트리밋**(`ratelimit.py`): 유저당 60회/분 인메모리. 시나리오가 41개 operation 전체로 넓어지므로 **유저당 60회 미만으로 자르거나 유저를 늘린다** — 초판보다 더 빠듯해졌다

## `openapi.json` diff 리포터

Java의 springdoc 출력과 기존 스펙을 비교한다. 보고 항목: path/operation·컴포넌트·필드·타입·`required`·nullable(`anyOf [T,null]`)·status code·`additionalProperties` 변화.

**`/SPEC.md` §4의 datetime 통일만 예외로 허용**하고 그 외 diff는 실패로 보고한다. admin은 별도 snapshot으로 비교한다.

## 하지 말 것

1. **`FakePlatformStore` 같은 인메모리 미러를 만들지 않는다.** 양쪽 다 실 Postgres.
2. **기존 테스트 파일을 수정하지 않는다.** 필요한 상수는 추출해 fixture로 복제한다.
3. **`apps/api` 소스를 수정하지 않는다.**
4. **완료 기준에 개수를 하드코딩하지 않는다.**
5. 과도한 추상화 금지 — M6에서 버릴 도구다.
6. 스코프 밖 리팩터링 일체.

## 완료 기준 체크리스트

### 자기 검증 (핵심)
- [ ] **동일성**: 같은 FastAPI 앱을 두 스키마에 대해 돌리면 전 시나리오에서 **diff 0**
- [ ] **변조 감지**: 의도적으로 변조한 백엔드를 반드시 잡는다
  - [ ] 필드 하나 추가 → L1
  - [ ] 필드 하나 삭제 → L1
  - [ ] `null` 필드를 키째 생략 → L2
  - [ ] datetime을 `+00:00`으로 되돌림 → L2
  - [ ] enum 값을 대문자로 → L2
  - [ ] 멱등 replay의 키 순서 변경 → L3
  - [ ] 오류 `detail` 문자열 변경 → 오류 계약 검증
  - [ ] **404 두 표기를 서로 바꿔치기**(`practice session not found` ↔ `practice_session_not_found`) → 오류 계약 검증
  - [ ] `X-Request-Id` 응답 헤더 누락 → 헤더 검증
  - [ ] 커뮤니티 커서 방향 뒤집기 → 커뮤니티 시나리오
  - [ ] 조회수를 증가 **후** 값으로 반환 → 커뮤니티 시나리오

### 기대값 fixture
- [ ] 성공 응답 형상이 **소스에서 생성**된다 (하드코딩 아님)
- [ ] 오류 계약이 소스에서 **AST 파싱으로** 생성된다 (멀티라인 detail 포함)
- [ ] 멱등 전이표 추출
- [ ] admin 프로파일용 별도 OpenAPI snapshot
- [ ] fixture와 실제 소스가 어긋나면 실패하는 드리프트 검증
- [ ] **unknown key 허용 집합이 `openapi.json`에서 생성된다** — 숫자·목록을 박지 않는다

### diff 리포터
- [ ] `openapi.json` 자기 자신과 비교 시 diff 0
- [ ] 8개 diff 유형을 각각 감지하는 단위 테스트

### 운용
- [ ] 두 스키마 시드가 동일하고 고정 UUID가 양쪽에서 같다
- [ ] symbolic ID 정규화가 동작하고, 후속 요청은 각 백엔드의 실제 ID를 쓴다
- [ ] 레이트리밋에 걸리지 않는다
- [ ] 시나리오 실행 5분 이내
- [ ] CI에서 실행 가능
- [ ] **41개 operation 전부가 최소 1회 실행된다** (admin 2개는 별도 프로파일에서)
- [ ] `/health` 비교로 Java 백엔드 연결이 실제로 동작한다 (M0 산출물 대상)

## 검증 방법

```bash
python -m contract_harness --baseline fastapi --target fastapi    # diff 0
python -m contract_harness --self-test                            # 변조 감지
python -m contract_harness --baseline fastapi --target java --only /health
python -m contract_harness --coverage                             # 미실행 operation 보고
```

## 미결 사항

- 두 백엔드를 띄우는 방식(프로세스 직접 vs docker-compose) — 구현자가 정한다. CI에서 돌아야 한다
- symbolic ID 치환의 구현 형태 — 응답 본문뿐 아니라 후속 요청 경로·헤더에도 ID가 들어간다
- `POST /v2/coach/confirm`의 멱등 계약 — 기존 테스트에 근거가 없어 **소스(`coaching.py:build_router.coach_confirm`)에서 직접 읽어 확정해야 한다**
