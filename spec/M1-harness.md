# M1 — 계약 동등성 하네스

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M1 사이클에만 적용된다.**
소스 참조는 `파일:심볼` 형식이다(`/SPEC.md` §12). 경로 기준도 거기에 있다.

> **2026-08-06 개정.** M0 종료와 M1 착수 사이에 `SOMA-302`(AI 3개 층 교체)가 dev에 들어왔다.
> 초판이 근거로 삼은 사실 중 상당수가 바뀌어(`SceneSummary` 소멸, unknown key 허용 7→5,
> `POST /v2/coach/confirm` 신설, 오류 detail 표기 변경) 기대값 소스를 다시 뽑았다.
> 바뀐 항목은 본문에 ⚠로 표시했다.
>
> **2026-08-06 2차 개정.** 위 개정 커밋은 `SOMA-304`(coach resume, PR #95)를 **포함하지 않은
> 시점에서 쓰였다**(`git merge-base`로 확인). 그 뒤 `coach_start`에 **멱등 클레임보다 먼저 실행되는
> resume 분기**가 생겨 L3 대상 한 건이 성립하지 않게 됐다. 2차 개정분은 🔁로 표시했다.
> 계약 인벤토리(operation 41개, unknown key 허용 5개, `anyOf [T,null]` 97곳)는 실측 결과 그대로다.
>
> **2026-08-06 3차 개정.** 구현 착수 전 Codex 적대적 리뷰에서 blocker 2건과 사실오류 3건이 나왔다.
> 3차 개정분은 🔎로 표시했다. 핵심은 셋이다:
> ① **`next_cursor`가 UUID를 base64 안에 숨겨** 자기 검증 `diff 0`이 애초에 불가능했다 → §opaque 값 정책
> ② **Java에 존재할 수 없는 in-process 주입점**을 전제로 써 있어 이중 구현이 갈릴 수밖에 없었다 → §백엔드 adapter 계약
> ③ **datetime을 마스킹하면서 형식 변조를 잡겠다**는 자기모순 → §datetime
> 사실오류였던 것: admin 경로(`/admin/*` → **`/v2/admin/*`**), 동의 게이트("전부 403" → **라우터마다 다름**),
> 워커 자동 기동(끄는 방법이 없었다). 여기에 검출력 갭 7건(canonicality·오류 manifest·워커 실패 경로·
> 동시성·토큰 corpus·rate limiter·요청 validation)을 시나리오로 추가하고, 모호성 11건을 §구현 규약으로 못박았다.

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

### 🔎 백엔드 adapter 계약 — 이중 구현이 갈리는 지점

`app.py:create_app`의 주입점(`analyzer`·`coach_generate`·`report_generate`·`s3_storage`·`provider_registry`·`analysis_worker`·`clock`)은 **전부 in-process Python 객체다.** Java에는 이런 것이 존재할 수 없는데, 2차 개정까지 이 문서는 "네 주입점을 모두 막아야 한다"고만 적고 Java 쪽 등가물을 정의하지 않았다. **정의 없이 이중 구현을 시작하면 한 명은 in-process로 띄우고 다른 한 명은 fake HTTP 서버를 세운다 — 대조가 불가능해진다.**

→ **하네스가 백엔드에 요구하는 것은 "제어 표면(control surface)" 하나뿐이다.** 그 뒤를 어떻게 구현하는지는 백엔드별 자유다.

**① 제어 표면** — loopback 전용, contract 프로파일에서만 활성:

| 제어 | 의미 |
|---|---|
| `run-worker-once` | 분석 워커를 **1틱** 돌리고 처리한 operation 수를 돌려준다 (`analysis_worker.py:AnalysisWorker.run_once`) |
| `run-sweep` | max-attempts 소진분을 최종 실패로 넘긴다 (`:AnalysisWorker.sweep`) |
| `stub-state` | LLM·S3·인증 스텁의 **남은 큐 길이와 호출 횟수**를 돌려준다 |
| `advance-clock` | 주입 시계를 N초 전진시킨다 (rate limiter window·lease 만료용) |
| `db-projection` | 지정한 도메인 객체의 **정규화된 DB 상태**를 돌려준다(§DB projection) |

**자동 워커는 이 프로파일에서 뜨지 않는다.** 시간 경과에 의존하는 동작은 전부 `advance-clock`으로만 일어난다.

**② `apps/api`는 고치지 않는다.** Python 쪽 제어 표면은 하네스가 만든다 — 하네스가 `create_app(...)`을 직접 호출해 앱을 얻고, **그 앱을 감싸는 얇은 ASGI 래퍼에 제어 라우트를 붙인다.** 스텁은 기존 주입점으로 넣는다. 소스 무수정 원칙(§하지 말 것 3)이 그대로 유지된다.

**③ Java 쪽은 M1 범위 밖이다.** M1 시점 Java는 `/health`뿐이므로, Java adapter는 **제어 표면 없이 `/health`만 응답하는 최소 구현**으로 둔다. 위 표를 만족시키는 것은 M4의 일이며, **이 표가 곧 M4에 넘기는 요구사항이다** — `spec/M4-llm.md`에 반영한다.

**④ 외부 의존의 값은 공유 fixture에서 읽는다.** 스텁을 어떻게 만들든(in-process 객체든 fake HTTP든), **반환값은 `tools/contract-harness/contract_harness/fixtures/` 아래 JSON 파일 하나에서 온다.** 언어가 달라도 같은 파일을 읽으면 같은 값이 나온다. 대상은 LLM 생성 결과, S3 객체 메타(HEAD 크기·ETag), 인증 provider 검증 결과다.

### 🔎 DB projection — 응답만으로는 안 보이는 상태

멱등·lease·재시도 계약의 상당 부분은 **HTTP 응답에 드러나지 않는다.** `db/store.py:PostgresStore.release_external_operation`이 `attempt_count`를 되돌리지 않는다는 것, sweep 전후로 `status`가 어떻게 바뀌는지가 그렇다. 응답만 비교하면 **release를 안 하거나 attempt를 되감는 Java도 통과한다.**

→ 제어 표면의 `db-projection`은 다음을 **정규화해서**(UUID symbolic 치환, 시각 마스킹) 돌려준다: external operation의 `status`·`attempt_count`·`error_code`·lease 소유자·lease 만료 유무, coach session의 `status`와 턴 수, refresh token 계보의 revoke 상태.

### 3단 비교

| 층 | 대상 | 방법 |
|---|---|---|
| **L1 스키마** | 전 응답 | `openapi.json` 컴포넌트로 strict 검증. 응답 컴포넌트 26개가 **전부** `additionalProperties: false`라 필드 과부족이 즉시 잡힌다 |
| **L2 정규화 diff** | 전 응답 | 마스킹·symbolic 치환 후 JSON 구조 비교. **키 존재 여부까지** 비교 |
| **L3 바이트 동등** | 멱등 replay | **백엔드 간이 아니라 각 백엔드의 최초 응답 ↔ 자체 replay** |

**L3를 백엔드 간으로 잡으면 안 된다** — ID가 다르므로 애초에 바이트가 같을 수 없다. 검증하려는 계약은 "같은 요청을 두 번 보내면 바이트가 같다"(`sync_operations.py:_json_response`의 canonical 인코딩)이므로, 각 백엔드 안에서 성립하면 된다.

🔎 **하지만 자체 replay 동등만으로는 canonical 인코딩을 증명하지 못한다.** `sync_operations.py:_json_response`는 `sort_keys=True` · 공백 없는 separator · `ensure_ascii=False`를 명시한다. 그런데 **키를 정렬하지 않는 Java도, 한글을 `\uXXXX`로 escape하는 Java도, 그 방식을 최초 응답과 replay에 일관되게 쓰기만 하면 바이트가 같다.** 현재 변조 감지 목록도 replay 쪽 키 순서만 바꾸는 경우를 상정한다.

→ **L3는 독립적인 두 단언으로 나눈다.**

| 단언 | 내용 |
|---|---|
| **L3-a 자체 replay 동등** | 최초 응답 bytes == replay 응답 bytes |
| **L3-b canonicality** | `raw_body == canonical_encode(json_parse(raw_body))` — 키 정렬·구분자·비ASCII 원문 유지를 **응답 하나만 보고** 판정한다 |

L3-b는 L3 대상뿐 아니라 **모든 sync operation 응답**에 건다. 비용이 거의 없고, 여기서 걸리는 구현 차이는 프론트가 캐시 키를 잡는 방식까지 흔든다.

**L3 대상** — `tests/test_response_contracts.py:test_declared_response_models_validate_real_success_payloads_and_replays`가 `.content ==`로 바이트 동등을 요구하는 지점 전부:

| 엔드포인트 | 비고 |
|---|---|
| `POST /v2/practice-sessions` | 202 accepted replay, succeeded replay 두 경로 모두 |
| `POST /v2/coach/start` | 🔁 **`restart: true`로만 관측한다.** 아래 참조 |
| `POST /v2/coach/reply` | |
| `POST /v2/reports` | 응답 모델이 `PracticeReport`로 바뀌었다 (⚠ 구 `CreateReportResponse` 소멸) |

⚠ **초판과 달라진 두 가지**:
- `POST /v2/practice-sessions/{id}/analyze`는 이제 **바이트 동등 단언이 없다**(형상 검증만 남았다). 멱등 계약 자체는 유효하므로 **하네스는 L3 대상으로 유지하되, 기존 테스트가 근거가 아님을 기록한다**
- `POST /v2/coach/confirm`은 **신규인데 replay 테스트가 아예 없다.** `X-Request-Id`를 받는 sync operation이므로 L3 대상에 넣고, **하네스가 이 공백을 메운다**

🔁 **`POST /v2/coach/start`의 멱등 계약은 `restart` 값에 따라 갈린다.**

`SOMA-304`가 넣은 resume 분기(`coaching.py:build_router.coach_start`)가 **`begin_sync_operation` 호출보다 앞에 있다.** 따라서 경로가 둘로 나뉜다:

| `restart` | 두 번째 요청이 타는 경로 | L3 성립 |
|---|---|---|
| `false`(기본값) | 열린 코치 세션이 있으면 **resume** — `store.get_oldest_open_coach_session` → `sync_operations.py:sync_response`. fingerprint를 계산하지 않고 sync operation 레코드도 만들지 않는다 | **불가** |
| `true` | resume 분기를 건너뛰고 기존 fingerprint·클레임 경로 | 가능 |

- **하네스는 `restart: true`로 L3를 관측한다.** `restart: false`로 replay를 시도하면 저장된 응답이 아니라 `_resumed_coach_payload`가 돌아온다 — `message`는 마지막 `ai` 턴에서 뽑고 `handoff`·`report`는 항상 `null`이라 **본문이 최초 응답과 다르다.** 이걸 L3 대상으로 두면 성립하지 않는 계약을 검증하게 된다
- **resume 경로는 버리지 않고 L2 시나리오로 따로 덮는다**(아래 §시나리오). `X-Request-Id` 응답 헤더는 이 경로에서도 나오므로 헤더 검증 대상이다
- `restart: true`는 기존 열린 세션을 닫는 부작용이 있다(`db/store.py:PostgresStore.complete_coach_start_operation`의 `restart` 인자). 시나리오 순서를 짤 때 **resume 검증을 restart 검증보다 먼저** 둔다

⚠ **`SceneSummary` 예외 조항은 삭제됐다.** 초판은 이 컴포넌트만 `additionalProperties: true`라 "스키마가 아니라 값 동일성으로 비교"하라고 했으나, `SOMA-302`가 스키마에서 제거했다. 현재 응답 컴포넌트에 열린 것은 FastAPI가 만드는 `HTTPValidationError`뿐이다.

### 마스킹 대상

| 값 | 출처 | 처리 |
|---|---|---|
| API 생성 UUID 전반 | 런타임 생성 | symbolic 치환(위 3번) |
| `access_token` / `refresh_token` | jti·iat·exp가 매번 다름 | 🔎 opaque — 아래 정책 |
| `next_cursor` | `db/community_store.py:encode_cursor` | 🔎 opaque — 아래 정책 |
| `playback_url` / `upload_url` | presign 서명 | 🔎 opaque — 아래 정책 |
| `created_at`/`updated_at`/`expires_at`/`occurred_at`/`published_at` | 시계 | 🔎 **검증 후** 마스킹 |
| `HealthResponse.commit` | `app.py:create_app`의 환경변수 | 마스킹 |

마스킹은 **값만** 지우고 **키와 타입은 검증**한다. `null`인지 문자열인지가 계약이다.

### 🔎 opaque 값 정책 — symbolic 치환으로 덮이지 않는 구멍

**`next_cursor`가 하네스를 통째로 막는다.** `db/community_store.py:encode_cursor`는 `base64(f"{created_at.isoformat()}|{row_id}")`다. **row UUID와 DB 시각이 문자열 안에 숨는다.** 독립 스키마 두 벌은 서로 다른 UUID를 만들므로 **cursor 문자열은 절대 같아질 수 없다.** 응답 본문의 UUID만 symbolic으로 바꾸는 규칙으로는 이걸 잡지 못하고, **"같은 FastAPI를 두 스키마에 돌리면 diff 0"이라는 자기 검증부터 실패한다.**

반대로 cursor를 통째로 마스킹하면 **잘못된 cursor 생성 규칙을 영원히 놓친다.**

→ **opaque 값은 "backend-local continuation token"으로 정의한다.** 값 자체를 교차 비교하지 않는 대신, **그 값이 하는 일**을 비교한다:

| 값 | 교차 비교 | 대신 검증하는 것 |
|---|---|---|
| `next_cursor` | 안 함(non-null 여부·타입만) | **각 백엔드의 token을 그 백엔드의 다음 요청에 그대로 넣어** 페이지를 끝까지 순회한 뒤, **누적 결과 시퀀스**를 symbolic 치환 후 비교한다. 중복·누락·정렬 방향·마지막 페이지의 `next_cursor` null 여부가 여기서 잡힌다 |
| `access_token`·`refresh_token` | 안 함 | 토큰은 Python이 발급하고 양쪽이 소비한다(위 4번). 응답에 실린 토큰은 **디코드해 claim 집합**(`sub` 제외 키 이름, `typ`, `iss`, `aud`)을 비교한다 |
| `playback_url`·`upload_url` | 안 함 | **URL을 파싱해** scheme·host·path 구조와 쿼리 **키 집합**을 비교한다. 서명값만 마스킹한다. presign fallback 시 형태가 달라지는 것이 계약이다 |

**추가로 Python 쪽에서만 가능한 검증**: `db/community_store.py:decode_cursor`로 자기 cursor를 풀어 `(created_at, id)` 경계 의미가 목록의 마지막 행과 일치하는지 fixture로 단언한다. Java의 cursor 내부 형식은 강제하지 않는다 — **관측 가능한 계약은 순회 결과이지 문자열이 아니다.**

### 🔎 datetime — 마스킹 **전에** 검증한다

2차 개정까지의 규칙은 자기모순이었다. `created_at` 계열을 값째 지우면서, 동시에 변조 감지 목록은 "datetime을 `+00:00`으로 되돌림 → L2가 잡는다"고 적었다. **값을 지우면 형식도 같이 사라지므로 절대 잡히지 않는다.**

→ 순서를 고정한다. **① 형식·의미 검증 → ② 마스킹 → ③ 교차 diff.**

① 단계에서 보는 것:

- **형식**: 백엔드 role별로 다르게 판정한다. FastAPI baseline은 현행 출력을 그대로 허용하고, **Java target에는 `/SPEC.md` §4가 정한 `Z` 접미사와 마이크로초 6자리를 강제**한다. 이게 M4의 유일한 의도적 breaking change이므로 하네스가 그 경계를 지켜야 한다
- **의미 불변식**: `expires_at > created_at`(`uploads.py:build_router.create_intent`의 `now + UPLOAD_INTENT_TTL`), 목록 응답의 시각 정렬 방향, `updated_at >= created_at`. TTL 길이 자체는 설정값이므로 **양쪽이 같은 설정을 쓴다는 전제 아래 차이만** 본다

②에서 instant 값을 sentinel로 바꾸고 ③으로 넘긴다. **①을 건너뛴 구현은 `+00:00`도, 밀리초 3자리도, 임의의 미래 시각도 통과시킨다.**

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
   - 🔁 **resume 경로는 LLM을 전혀 호출하지 않는다.** `_resumed_coach_payload`가 마지막 `ai` 턴을 그대로 되돌려준다. 따라서 **큐가 소비되지 않았다는 것 자체가 검증 대상**이다 — 스텁은 남은 큐 길이를 노출해야 하고, 이걸 확인하지 않으면 "resume인 척하면서 실제로는 새 발화를 생성하는" 구현을 통과시킨다
2. **비동기 경로(분석 워커)**: **`analyzer` 레벨**(`create_app(analyzer=...)`)로 자른다. 워커는 백그라운드가 아니라 **`run_once()` 동기 훅**으로 구동한다(`analysis_worker.py:AnalysisWorker.run_once`). Java에도 동등 훅이 필요하다 — M4 SPEC에 반영됨
   - 🔎 **자동 기동을 반드시 꺼야 한다.** `app.py:create_app`의 lifespan은 `analysis_worker`가 `None`이 아니면 무조건 `.start()`를 부르고, 이건 백그라운드 스레드를 띄운다(`analysis_worker.py:AnalysisWorkerPool.start`). 그대로 두면 **자동 폴링과 하네스의 `run_once()`가 같은 operation을 두고 경합해 비결정이 된다.**
   - 끄는 방법: `create_app(analysis_worker=<stub>)`으로 **`start()`·`stop()`이 no-op이고 내부 `AnalysisWorker`를 그대로 노출하는 스텁**을 주입한다. `analysis_worker`가 주입되면 자동 생성 분기(`analysis_worker is None and s3_storage is not None and ...`)를 타지 않는다
   - **Java도 같은 계약을 만족해야 한다** — contract 프로파일에서 자동 워커가 뜨지 않고, 외부에서 1틱씩 구동할 수 있어야 한다(아래 §백엔드 adapter 계약)

**하네스는 네 주입점을 모두 막아야 한다.** 하나라도 열려 있으면 네트워크를 타서 비결정이 되고 CI에서 깨진다.

## 기대값 소스

**숫자를 하드코딩하지 않는다**(`/SPEC.md` §6-2). 아래는 전부 **소스/OpenAPI에서 생성한 inventory**로 만들고, 집합 동등성으로 판정한다.

**이 원칙이 왜 절대적인가**: 초판은 "요청 바디 16개 중 7개가 unknown key 허용", "`default` 0개", "`anyOf [T,null]` 86곳"을 본문에 박아 뒀다. 넉 달 만에 각각 17개 중 5개 / 9개 / 97곳이 됐다. **박아 둔 숫자는 전부 틀렸고, 그것을 근거로 이식했다면 조용히 잘못된 구현이 나왔다.**

🔁 그리고 **1차 개정에서 적은 `default` 9개는 하루도 못 가 10개가 됐다** — `SOMA-304`가 `CoachStartReq.restart: bool = False`를 넣었다(`acting-agent/schema.py:CoachStartReq`). 같은 변경으로 컴포넌트도 69→70개다(`PublicCoachTurn` 신설). **이 문단의 숫자들은 예시일 뿐이며, 하네스가 읽어야 할 값은 언제나 실행 시점의 `openapi.json`과 소스다.**

### ① 성공 응답 형상

`tests/test_response_contracts.py:SUCCESS_RESPONSE_MODELS`와 `:RESPONSE_COMPONENT_SHAPES`를 기계 판독 가능한 fixture로 추출한다. 원본 테스트 파일은 건드리지 않는다.

### ② 오류 계약

`openapi.json`에 없다(`/SPEC.md` §6-2). 소스에서 `(method, path, 조건) → (status, detail)`을 추출한다.

🔎 **AST 추출만으로는 오류 계약을 검증할 수 없다 — inventory와 실행을 분리한다.** 추출기는 `raise HTTPException(...)`을 찾을 뿐, **어떤 요청이 그 분기에 도달하는지는 모른다.** 게다가 오류의 상당수가 라우트 밖에서 난다:

| 오류 | 발생 위치 | AST로 잡히나 |
|---|---|---|
| 인증 401 | `auth/dependencies.py:build_current_user_dependency`·`:build_optional_user_dependency` | 라우트가 아니라 의존성 |
| 자격증명 503 | `app.py:create_app`의 exception handler | 핸들러 |
| coach 502 detail | `coaching.py:build_router.coach_start`·`.coach_reply`의 `str(exc)` | **동적 문자열** |
| 422 cross-field | `coaching.py:CoachConfirmReq.validate_rebuttal`, `practice_sessions.py:PracticeSessionRequest.validate_blockage_branch` | Pydantic validator라 `HTTPException`이 아예 없음 |

→ **AST 결과는 drift inventory로만 쓴다.** 판정은 **실행 manifest**가 한다:

- manifest의 각 케이스는 `case_id → (setup, request, expected status/detail/headers, expected DB projection)` 형태다. 사람이 쓰고, 소스를 근거로 검토한다
- **inventory의 모든 항목은 manifest 케이스에 연결되거나, 명시적 제외 사유를 달아야 한다.** 미연결 항목이 하나라도 남으면 **하네스가 실패한다** — 이게 드리프트 방어선이다
- 동적 detail(`str(exc)`)은 **스텁이 던지는 예외를 고정**해 결정적으로 만든다. 어떤 예외에 어떤 문자열이 나오는지를 manifest에 적는다

주의:
- 공백 포함 문장과 snake_case가 섞여 있다
- **같은 상태코드에 두 표기가 공존한다** — 404에 `practice session not found`와 `practice_session_not_found`가 둘 다, 409에 `report already exists`와 `report already exists for practice session`이 둘 다 있다. 라우터별로 정확히 갈라야 한다
- 🔁 **`coach_start` 안에서 409 `report already exists for practice session`이 두 지점에서 난다** — resume 분기(클레임 없음)와 클레임 획득 뒤(`fail_sync_operation`으로 `report_already_exists` 기록). **응답은 같지만 sync operation 부작용이 다르다.** 오류 계약 추출은 `(method, path, 조건) → (status, detail)`만 보므로 이 차이를 놓친다. 시나리오에서 **두 경로를 모두 밟고 operation 레코드 유무까지 비교**한다
- 422 validation만 `detail`이 배열이다
- ⚠ 초판이 "멀티라인이라 단순 grep에 안 잡힌다"고 예시한 `upload_intent_not_finalized_or_already_used`는 **더 이상 없다.** 현재는 `upload_intent_not_finalized`·`upload_not_found`로 갈렸다. 멀티라인 함정 자체는 남아 있으므로 **AST 파싱으로 추출**한다(정규식 금지)

### ③ 멱등 전이표

`tests/test_platform_v2.py:test_practice_session_running_succeeded_failed_and_fingerprint_branches` + `apps/api/API.md`. 단 API.md는 드리프트했으므로(`/SPEC.md` §9) 소스를 우선한다.

### ④ 조건부 라우트 — 별도 프로파일

🔎 admin 2개(**`/v2/admin/stats`, `/v2/admin/sessions`**)는 `ADMIN_OPS_TOKEN`이 있을 때만 등록된다(`app.py:create_app`, `admin.py:build_router`). **committed `openapi.json`에 아예 없다.**

→ `ADMIN_OPS_TOKEN`을 설정한 상태의 **별도 OpenAPI snapshot**을 만들고, admin 인증(토큰 없음 → 401)·nullable·presign fallback을 별도 시나리오로 둔다. **snapshot에 이 두 operation이 정확히 추가되는지 단언한다** — 개수만 세지 말고 경로 문자열을 비교한다.

🔎 **경로 접두사에 주의한다.** `admin.py:build_router`는 `APIRouter(prefix="/v2/admin")`으로 만들고 그 안에 `/stats`·`/sessions`를 단다. 2차 개정까지 이 문서는 `/admin/*`로 적고 있었다 — **존재하지 않는 경로였다.**

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
| 🔁 **코치 resume·restart** | ① `start`(신규 생성) → `reply` → **`start` 재호출(`restart` 생략)** → 같은 `session_id`로 이어받고 `turns`가 전량 반환되며 새 코치 발화가 생기지 않는지(=`generate_text` 호출 큐가 소비되지 않는지) ② 이어서 **`start`(`restart: true`)** → 새 `session_id`가 나오고 이전 세션이 닫히는지 ③ `restart: true` + 같은 `X-Request-Id` 재전송 → L3 바이트 동등 ④ 리포트 확정 후 resume 시도 → 409 |
| **커뮤니티** | 16개 경로 전부. 목록 커서(글 DESC / 댓글 ASC), 익명 별칭 번호, 차단 필터, 좋아요 카운트, 신고 중복, 조회수 증가 시점 |
| **프로필** | `/v2/me` GET·PATCH. nickname 정규화 |
| **admissions** | 공개 조회 2개 |
| **동의** | `GET /v2/consents/pending` |
| **admin** (별도 프로파일) | 토큰 있음/없음, presign fallback. 경로는 **`/v2/admin/*`** |
| **상태코드** | `tests/test_platform_v2.py`의 413/415·complete 멱등·소유권 404·error_code 파라미터화 |
| 🔎 **동의 전 matrix** | 동의하지 않은 유저로 위 §게이트 표의 네 계층을 전부 때린다. 403이어야 할 것과 통과해야 할 것을 각각 단언한다 |
| 🔎 **워커 실패 경로** | ① known failure 3종(timeout·parse·unsupported media → 즉시 `failed`, `analysis_worker.py:analysis_error_code`) ② transient 오류 3회(→ release, **`attempt_count`는 되돌아가지 않는다**) ③ `run-sweep`으로 max-attempts 소진분 최종 실패 ④ lease 소유권 상실. **각 단계마다 `db-projection` 비교** |
| 🔎 **동시성** | barrier로 동시에 때린다: 같은 `X-Request-Id`의 중복 세션 생성(`db/store.py:PostgresStore.create_practice_session_with_analysis_operation`의 보상 삭제), refresh 회전(`:rotate_refresh_token`의 row lock), 같은 코치 세션 동시 reply(`:_save_coach_session`의 턴 전량 비교), 같은 글 동시 좋아요(`db/community_store.py:CommunityStore.like_post`의 upsert 후 재집계). **응답 집합 + 최종 DB projection**을 비교한다. SELECT-then-INSERT나 read-modify-write로 이식하면 여기서 깨진다 |
| 🔎 **토큰 corpus** | `auth/jwt.py:JwtService._decode`가 거부해야 하는 것 전부: 서명 변조, header에 `kid` 추가, 잘못된 `iss`/`aud`, 잘못된 token type, 미래 `iat`, `exp` 경계(`exp <= now`는 배타적). **각각 401이어야 한다** |
| 🔎 **refresh 회전** | 두 세션 발급 → 하나 회전 → **구 token 재사용** → `db/store.py:PostgresStore.rotate_refresh_token`이 그 유저의 **전 세션을 revoke**하는지. 다른 세션의 replacement까지 거부되는 것이 계약이다 |
| 🔎 **rate limiter** | 메인 플로우와 **분리된 fresh 프로세스**에서 `advance-clock`으로: 60/61 경계, 유저 간 격리, IP 간 격리(`auth/router.py:build_router`가 같은 limiter에 IP·user 키를 모두 기록), window rollover. 두 백엔드의 limiter 상태는 공유하지 않는다 |
| 🔎 **요청 validation 경계** | OpenAPI에 표현되지 않는 것들: `practice_sessions.py:PracticeSessionRequest.validate_blockage_branch`의 `blockage_kind × sub_branch` 조합, `coaching.py:CoachConfirmReq.validate_rebuttal`(`confirmed=false`면 공백 아닌 rebuttal 필수), `community.py:PostWriteRequest`·`CommentWriteRequest`의 trim + 길이 경계, 공백-only nickname |

### 게이트 둘을 셋업에서 처리

🔎 **동의 게이트는 "전부 403"이 아니다 — 라우터마다 다른 의존성이 걸려 있다.** 2차 개정까지 이 문서는 미동의 시 전부 403이라고 적었으나, `app.py:create_app`이 실제로 연결하는 것은 넷이다:

| 의존성 | 걸린 곳 | 미동의 상태에서 |
|---|---|---|
| `consented_user`(`auth/dependencies.py:build_consent_gate_dependency`) | uploads, practice-sessions 조회·생성, coach, reports, community **쓰기**(`author=`) | **403** |
| `rate_limited_user`(`:build_rate_limited_user_dependency`) | `/v2/me` GET·PATCH | 통과 |
| `optional_user`(`:build_optional_user_dependency`) | community **읽기**(`viewer=`) | 통과(비로그인도 가능) |
| `ungated_user` | `practice_sessions.py:build_router.delete_session` | 통과 — 인증만 요구 |

→ **동의 전 matrix를 시나리오로 실행한다.** 셋업에서 무조건 동의부터 하면, `/v2/me`나 community 읽기나 세션 삭제까지 **잘못 막는 Java가 통과한다.** 근거: `tests/test_auth.py:test_pending_consents_endpoint_and_protected_router_enforcement`가 미동의 상태의 세션 DELETE에서 consent 403이 아니라 실제 처리 결과인 404를 단언한다.

- 동의 후 본 시나리오는 종전대로 `POST /v2/consents` 선행. 약관 문서 UUID를 시드에서 고정하므로 양쪽이 같은 문서를 본다
- 🔎 **레이트리밋**(`ratelimit.py:RateLimiter.allow`): 유저당 60회/분, **monotonic 시계 기반 fixed window**, app 인스턴스별 인메모리. 본 시나리오는 여기 걸리지 않게 유저를 늘려 자르되, **경계 자체는 별도 시나리오로 검증한다**(아래 §rate limiter). 피하기만 하면 limiter가 아예 없는 Java도 통과한다

## `openapi.json` diff 리포터

Java의 springdoc 출력과 기존 스펙을 비교한다.

🔎 **"diff 0"은 전체 문서의 semantic equality를 뜻한다** — 아래는 반드시 보는 항목의 목록이지, 비교 범위를 이것으로 한정한다는 뜻이 아니다. **열거되지 않은 키에서 난 차이도 실패로 보고한다.** 부분 비교로 만들면 `const` 하나, 길이 제한 하나가 조용히 사라진다.

| 분류 | 항목 |
|---|---|
| 구조 | path · operation · `operationId` · 컴포넌트 · 필드 · status code |
| 타입 | 타입 · `format` · `enum` 값 · `const` · nullable(`anyOf [T,null]`) |
| 제약 | `required` · `default` · `minLength`/`maxLength` · 수치 bound · `additionalProperties` |
| 그 외 | parameters · requestBody의 required 여부 · security · tags |

**`/SPEC.md` §4의 datetime 통일만 예외로 허용**하고 그 외 diff는 실패로 보고한다. admin은 별도 snapshot으로 비교한다.

**비교는 순서 무관하게 한다** — `required` 배열이나 `enum` 순서가 달라진 것은 diff가 아니다. 단, `enum`의 **집합**이 달라지면 diff다.

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
  - [ ] datetime을 `+00:00`으로 되돌림 → 🔎 **datetime 형식 검증**(마스킹 전 단계. L2는 값을 이미 지웠으므로 못 잡는다)
  - [ ] 🔎 datetime 소수 자릿수를 3자리로 → datetime 형식 검증
  - [ ] 🔎 `expires_at`을 `created_at`보다 앞서게 → datetime 의미 불변식
  - [ ] enum 값을 대문자로 → L2
  - [ ] 멱등 replay의 키 순서 변경 → L3-a
  - [ ] 🔎 **최초 응답과 replay 양쪽 모두 키를 정렬하지 않음** → L3-b canonicality (L3-a는 통과한다)
  - [ ] 🔎 한글을 `\uXXXX`로 escape → L3-b canonicality
  - [ ] 오류 `detail` 문자열 변경 → 오류 계약 검증
  - [ ] **404 두 표기를 서로 바꿔치기**(`practice session not found` ↔ `practice_session_not_found`) → 오류 계약 검증
  - [ ] `X-Request-Id` 응답 헤더 누락 → 헤더 검증
  - [ ] 커뮤니티 커서 방향 뒤집기 → 커뮤니티 시나리오
  - [ ] 조회수를 증가 **후** 값으로 반환 → 커뮤니티 시나리오
  - [ ] 🔁 **resume 분기를 멱등 replay 뒤로 옮김** → 코치 resume 시나리오 (열린 세션이 있는데도 새 세션이 생기거나, 저장된 replay 응답이 돌아온다)
  - [ ] 🔁 **`turns` 배열을 역순으로 반환** → 코치 resume 시나리오 (`turns`는 저장 순서가 계약이다)
  - [ ] 🔎 **cursor를 매 요청 새로 발급해 페이지가 겹치게** → 커뮤니티 순회 (cursor 값을 교차 비교하지 않으므로 **순회 결과로만** 잡힌다)
  - [ ] 🔎 **release 시 `attempt_count`를 되감음** → 워커 실패 경로 + DB projection
  - [ ] 🔎 **sweep을 구현하지 않음**(소진분이 영원히 pending) → 워커 실패 경로
  - [ ] 🔎 **transient 오류를 즉시 `failed`로 처리** → 워커 실패 경로
  - [ ] 🔎 **원자 연산을 SELECT-then-INSERT / read-modify-write로 교체** → 동시성 시나리오 (직렬 요청에서는 전부 통과한다)
  - [ ] 🔎 **rate limiter 미구현** → rate limiter 시나리오
  - [ ] 🔎 **JWT header에 `kid`가 있어도 허용** → 토큰 corpus
  - [ ] 🔎 **refresh 재사용 시 해당 세션만 revoke**(다른 세션은 살려둠) → refresh 회전 시나리오
  - [ ] 🔎 **consent gate를 전 라우트에 적용**(`/v2/me`·community 읽기·세션 삭제까지 403) → 동의 전 matrix
  - [ ] 🔎 **admin 경로를 `/admin/*`로 노출** → admin 프로파일 snapshot 경로 단언

### 기대값 fixture
- [ ] 성공 응답 형상이 **소스에서 생성**된다 (하드코딩 아님)
- [ ] 오류 계약이 소스에서 **AST 파싱으로** 생성된다 (멀티라인 detail 포함)
- [ ] 🔎 **AST inventory의 모든 항목이 실행 manifest 케이스에 연결되거나 명시적 제외 사유를 갖는다.** 미연결이 남으면 하네스가 실패한다
- [ ] 🔎 라우트 밖 오류(의존성 401, exception handler 503, Pydantic validator 422)가 manifest에 있다
- [ ] 멱등 전이표 추출
- [ ] admin 프로파일용 별도 OpenAPI snapshot — 🔎 `/v2/admin/*` 두 경로가 정확히 추가되는지 단언
- [ ] fixture와 실제 소스가 어긋나면 실패하는 드리프트 검증
- [ ] **unknown key 허용 집합이 `openapi.json`에서 생성된다** — 숫자·목록을 박지 않는다

### diff 리포터
- [ ] `openapi.json` 자기 자신과 비교 시 diff 0
- [ ] 🔎 §diff 리포터 표의 **전 항목**을 각각 감지하는 단위 테스트 (`const`·`format`·bound·security 포함)
- [ ] 🔎 열거되지 않은 키의 차이도 실패로 보고된다 (부분 비교가 아님을 증명하는 테스트)
- [ ] 🔎 `required`·`enum`의 **순서만** 다른 것은 diff가 아니다

### 운용
- [ ] 두 스키마 시드가 동일하고 고정 UUID가 양쪽에서 같다
- [ ] symbolic ID 정규화가 동작하고, 후속 요청은 각 백엔드의 실제 ID를 쓴다
- [ ] 🔎 **미등록 UUID를 만나면 새 심볼을 발급하지 않고 실패한다** (§구현 규약 ①)
- [ ] 🔎 **제어 표면 5개가 동작한다** — `run-worker-once`·`run-sweep`·`stub-state`·`advance-clock`·`db-projection`
- [ ] 🔎 **contract 프로파일에서 백그라운드 워커가 뜨지 않는다** (기동 후 아무 조작 없이 operation 상태가 변하지 않음을 단언)
- [ ] 🔎 **`apps/api` 소스가 수정되지 않았다** — 제어 표면은 하네스의 ASGI 래퍼에 있다 (`git diff --exit-code apps/api`)
- [ ] 🔎 **동시성 시나리오가 결정적으로 재현된다** — 같은 시드로 반복 실행 시 같은 결과
- [ ] 본 시나리오가 레이트리밋에 걸리지 않는다 / 🔎 **별도 시나리오에서는 경계를 의도적으로 넘는다**
- [ ] 시나리오 실행 5분 이내
- [ ] CI에서 실행 가능
- [ ] **41개 operation 전부가 최소 1회 2xx로 실행된다** (admin 2개는 별도 프로파일에서, §구현 규약 ⑦)
- [ ] `/health` 비교로 Java 백엔드 연결이 실제로 동작한다 (M0 산출물 대상)

## 검증 방법

```bash
python -m contract_harness --baseline fastapi --target fastapi    # diff 0
python -m contract_harness --self-test                            # 변조 감지 전량
python -m contract_harness --baseline fastapi --target java --only /health
python -m contract_harness --coverage                             # 미실행 operation 보고
python -m contract_harness --check-manifest                       # AST inventory ↔ manifest 미연결 항목 보고
python -m contract_harness --openapi-diff <a.json> <b.json>       # diff 리포터 단독 실행
```

## 🔎 구현 규약 (확정) — 이중 구현이 갈리지 않게 못박는 것

두 사람이 이 문서만 보고 각자 만들어도 같은 것이 나와야 한다. 아래는 **선택지가 아니라 규약**이다.

**① symbolic ID는 생성 지점에서 발급한다.** "처음 본 순서대로 번호를 매긴다"가 **아니다.** 생성 응답(`POST /v2/practice-sessions`의 `id` 등)에서 심볼을 확정하고, 이후 모든 등장을 그 심볼로 치환한다. **목록 응답에서 미등록 UUID를 만나면 새 번호를 주지 않고 실패한다.** 관측 순서로 번호를 매기면 **배열 순서를 뒤집어도 재번호화가 그것을 숨긴다** — 커뮤니티 커서 방향 변조가 통과해 버린다.

**② UUID map은 값 기준 단일 map이다.** 필드명별로 나누지 않는다. 같은 코치 세션이 `session_id`로도 `coach_session_id`로도 나타나므로, 필드별로 나누면 같은 객체가 서로 다른 심볼을 받는다. 심볼 **이름**은 발급 시점의 도메인에서 정한다(`$practice_session_1`, `$coach_session_1`, `$handoff_1`).

**③ 심볼은 응답 본문뿐 아니라 요청 경로·쿼리·헤더에도 적용한다.** 다만 **후속 요청에 실제로 보내는 값은 각 백엔드가 반환한 원본 ID**다(§채택 방식 3번). 심볼은 비교용 표현일 뿐 전송값이 아니다.

**④ opaque 값은 §opaque 값 정책을 따른다.** cursor·토큰·presign URL을 교차 비교하지 않는다.

**⑤ datetime은 §datetime 절의 순서(검증 → 마스킹 → diff)를 따른다.**

**⑥ 외부 의존 스텁의 값은 `tools/contract-harness/contract_harness/fixtures/`의 JSON에서 읽는다.**
- **LLM**: 호출 순서가 계약이므로 큐로 관리하고, `stub-state`로 **잔량과 호출 횟수**를 노출한다
- **S3**: 업로드는 실제로 하지 않는다. `complete`가 요구하는 HEAD 결과(존재·크기·ETag)와 워커가 쓰는 다운로드 대상 로컬 파일을 fixture로 준다
- **인증 provider**: `(provider, id_token) → subject/email` 매핑을 fixture로 준다. `DEVELOPMENT_AUTH_PROVIDER`에 의존하지 않는다

**⑦ coverage의 "operation 실행"은 `(path, method)`가 최소 1회 **2xx**로 실행된 것을 뜻한다.** 41개 전량 기준은 이것이다. 오류 status variant는 별도 집계이며 §오류 계약 manifest가 관리한다.

**⑧ `POST /v2/coach/confirm`의 멱등 계약** — 소스 확인 결과(`coaching.py:build_router.coach_confirm`) **표준 sync operation 경로를 그대로 탄다.** `begin_sync_operation` → replay면 저장된 `Response` 반환. **L3 대상으로 확정한다.**
- ⚠ **특이점**: 이 라우트는 `kind="report"`로 클레임한다(`coach_confirm`이 아니다). 즉 **`POST /v2/reports`와 같은 kind 네임스페이스를 공유**한다. 다만 fingerprint의 첫 인자는 `"coach_confirm"`이라 서로 다르다. **같은 `X-Request-Id`로 `coach/confirm`과 `reports`를 연달아 부르는 케이스를 manifest에 넣는다** — 이 조합을 잘못 이식하면 한쪽이 다른 쪽의 replay를 받는다

## 미결 사항

- 두 백엔드를 띄우는 방식(프로세스 직접 vs docker-compose) — 구현자가 정한다. CI에서 돌아야 한다
- 제어 표면의 transport(HTTP 라우트 vs CLI) — 구현자가 정한다. **양쪽 백엔드가 같은 형태여야 한다**는 것만 규약이다

🔁 `POST /v2/coach/start`의 멱등 계약은 **더 이상 미결이 아니다** — 위 §3단 비교에서 `restart` 값에 따라 확정했다.
🔎 `POST /v2/coach/confirm`의 멱등 계약도 **더 이상 미결이 아니다** — 위 §구현 규약 ⑧.
