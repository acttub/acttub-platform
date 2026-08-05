# M1 — 계약 동등성 하네스

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M1 사이클에만 적용된다.**

## 목적

빅뱅 전환이므로 **"기존과 똑같이 동작하는가"를 판정할 수단이 이것뿐이다.** M2 이후 모든 사이클의 완료 판정이 여기에 의존하므로, 실제 이식보다 먼저 세운다.

M1 시점에 Java 쪽은 `/health`밖에 없다. 따라서 **이 사이클의 검증은 "하네스가 옳은가"를 증명하는 것**이며, 그 방법은 §완료 기준에 정의한다.

## 위치·언어

- Python. `tools/contract-harness/` 아래.
- 기존 pytest 자산(픽스처·골든 데이터·토큰 발급)을 재사용한다.
- **M6에서 파이썬과 함께 폐기한다.** 영구 자산이 아니므로 과도한 추상화를 만들지 않는다.

## 아키텍처

### 공유 DB 방식

두 백엔드를 **같은 Postgres 스키마 + 같은 `JWT_SECRET`** 에 붙인다.

이유: `auth/dependencies.py:24-31`이 JWT `sub`의 UUID로 DB를 조회하는데, 유저 UUID는 DB `gen_random_uuid()` 생성이라 두 백엔드에 각각 로그인시키면 서로 다른 UUID가 나온다. 같은 DB를 공유해야 토큰 하나로 양쪽을 호출할 수 있다.

- 스키마 격리는 `apps/api/acting-api/tests/db_test_support.py:25-51`의 `acting_test_<uuid>` 패턴을 그대로 빌린다
- **쓰기 시나리오는 순서 의존이 있으므로 시나리오마다 스키마를 새로 만들어 각 백엔드에 대해 따로 돌린다.** 읽기 비교만 같은 데이터 위에서 동시에 한다
- 토큰은 **Python이 발급하고 양쪽이 소비**하는 단방향으로 간다. `jwt.py:147`이 헤더를 `{"alg":"HS256","typ":"JWT"}`와 정확히 비교하므로 Java 라이브러리가 `kid`를 자동 추가하면 깨진다. payload는 `sort_keys=True` 직렬화, `exp <= now`는 배타적 만료

### 3단 비교

| 층 | 대상 | 방법 |
|---|---|---|
| **L1 스키마** | 전 응답 | `openapi.json` 컴포넌트로 strict 검증. `additionalProperties: false`가 전부 걸려 있어 필드 과부족이 즉시 잡힌다 |
| **L2 정규화 diff** | 전 응답 | 비결정 필드 마스킹 후 JSON 구조 비교. **키 존재 여부까지** 비교(조건부 생략 때문) |
| **L3 바이트 동등** | 멱등 replay만 | `/v2/coach/*`, `POST /v2/reports`. canonical JSON 계약 검증 |

**예외**: `SceneSummary`만 `additionalProperties: true`다(`practice_sessions.py:60`, DB JSONB 원본을 펼침). 이 하위는 스키마가 아니라 **값 동일성**으로 비교한다 — 같은 stub LLM 응답 → 같은 JSONB → 같은 출력.

### 마스킹 대상 (LLM을 고정해도 비결정적인 값)

| 값 | 출처 |
|---|---|
| coach `session_id` | `coaching.py:104` `uuid4()` |
| 서버 생성 `X-Request-Id` | `sync_operations.py:31-37` |
| `access_token` / `refresh_token` | jti·iat·exp가 매번 다름 |
| `playback_url` / `upload_url` | presign 서명 |
| `created_at`/`updated_at`/`expires_at`/`occurred_at`/`published_at` | 시계 |
| `HealthResponse.commit` | `app.py:247` 환경변수 |

마스킹은 **값만** 지우고 **키와 타입은 검증**한다. `null`인지 문자열인지가 계약이다.

### LLM 스텁 — 봉합선 2개

실제 Gemini 호출은 3곳뿐(`summarizer.py:136`, `agent/engine.py:51`, `report/engine.py:38`)이고 전부 `client.models.generate_content(...)`. 주입점은 `app.py:113`의 `create_app(client=...)` 하나다.

1. **동기 경로(coach/report)**: `generate_content` 레벨. `api_test_support.py`의 `COACH_QUESTION`(:43-46)·`COACH_FOLLOWUP`(:47-50)·`REPORT`(:52-65) 골든 데이터를 **JSON 파일로 떠서 양쪽이 같은 파일을 읽게** 한다. 호출 순서가 곧 계약이므로 큐 순서를 고정한다.
2. **비동기 경로(분석 워커)**: `generate_content`를 잡아도 ffmpeg + Files API 때문에 불안정하다. **`analyzer` 레벨**(`create_app(analyzer=...)`, `app.py:105`)로 자르고, 워커는 백그라운드가 아니라 **`run_once()` 동기 훅**으로 구동한다(`test_response_contracts.py:536`). Java에도 동등 훅이 필요하다 — M4 SPEC에 반영한다.

## 기대값 소스 3개

### ① 성공 응답 형상

`apps/api/acting-api/tests/test_response_contracts.py`에서 추출한다:
- `SUCCESS_RESPONSE_MODELS` (:37-109, 35개) — `(method, path, status)` → 컴포넌트 이름 매트릭스
- `RESPONSE_COMPONENT_SHAPES` (:111-272, 34개) — 컴포넌트별 required/optional 필드 집합

**언어 무관한 명세이므로 기계 판독 가능한 fixture(JSON/YAML)로 떠서 하네스가 읽게 한다.** 원본 테스트 파일은 건드리지 않는다.

### ② 오류 계약 — `openapi.json`에 없으므로 새로 만든다

`/SPEC.md` §6-2 참조. 소스를 훑어 `(method, path, 조건) → (status, detail)` 표를 만든다. 40종.

주의 항목:
- 공백 포함 문장과 snake_case가 섞여 있다
- `/v2/practice-sessions` 409는 `upload_intent_not_finalized_or_already_used` (`practice_sessions.py:162`, 멀티라인이라 단순 grep에 안 잡힌다)
- 422 validation만 `detail`이 **배열**

### ③ 멱등 전이표

`test_platform_v2.py:340-381` + `apps/api/API.md:29-39`. `X-Request-Id` 기준 pending/running → 202, succeeded → 저장 payload 200, failed → 재실행 202, fingerprint 불일치 → 422.

## 시나리오

`test_response_contracts.py:440-698`이 이미 완성된 대본이다 — 로그인 → 약관 → 업로드 인텐트 → complete → 연습세션(202) → 워커 구동 → 재분석 → 코치 start/reply/close → 리포트 → 이력/상세 → 삭제 → 로그아웃. **이것을 하네스 시나리오로 번역한다.**

추가로 `test_platform_v2.py`의 상태코드 케이스(업로드 게이트 413/415, complete 멱등성, 소유권 404, error_code 파라미터화)를 케이스로 옮긴다.

### 게이트 두 개를 셋업에서 처리

- **동의 게이트** (`auth/dependencies.py:84-93`): 필수 약관 미동의면 업로드·세션·코치·리포트가 전부 403 `consent_required`. `POST /v2/consents`를 선행한다. 약관 문서는 lifespan이 시딩하므로 공유 DB면 양쪽이 같은 UUID를 본다
- **레이트리밋** (`:70-81`): 사용자당 60회/분 인메모리 고정 윈도우. **시나리오를 유저당 60회 미만으로 자르거나 유저를 늘린다**

## `openapi.json` diff 리포터

Java의 springdoc 출력과 기존 스펙을 비교한다. 보고 항목:
- path/operation 추가·삭제
- 컴포넌트 추가·삭제
- 필드 추가·삭제·타입 변경
- `required` 목록 변화
- `nullable`(`anyOf [T, null]`) 변화
- status code 변화
- `additionalProperties` 변화

**`/SPEC.md` §4의 datetime 통일은 예외로 허용**하되, 그 외 diff는 전부 실패로 보고한다.

## 하지 말 것

1. **`FakePlatformStore` 같은 인메모리 미러를 만들지 않는다.** 하네스는 양쪽 다 실 Postgres에 붙인다.
2. **기존 테스트 파일을 수정하지 않는다.** 필요한 상수는 추출해 fixture로 복제한다.
3. **`apps/api` 소스를 수정하지 않는다.**
4. 과도한 추상화 금지 — M6에서 버릴 도구다.
5. 스코프 밖 리팩터링 일체.

## 완료 기준 체크리스트

M1 시점엔 Java가 `/health`뿐이므로, **하네스 자신의 정확성을 증명하는 것**이 완료 기준이다.

### 자기 검증 (핵심)
- [ ] **동일성 테스트**: 같은 FastAPI 앱 두 인스턴스를 비교하면 전 시나리오에서 **diff 0**
- [ ] **변조 감지 테스트**: 응답을 의도적으로 변조한 백엔드와 비교하면 반드시 잡는다
  - [ ] 필드 하나 추가 → L1이 잡는다 (`additionalProperties: false`)
  - [ ] 필드 하나 삭제 → L1이 잡는다
  - [ ] `null` 필드를 키째 생략 → L2가 잡는다 (키 존재 여부 비교)
  - [ ] datetime을 `+00:00`으로 되돌림 → L2가 잡는다
  - [ ] enum 값을 대문자로 → L2가 잡는다
  - [ ] 멱등 replay의 키 순서 변경 → L3이 잡는다
  - [ ] 오류 `detail` 문자열 변경 → 오류 계약 검증이 잡는다
  - [ ] `X-Request-Id` 응답 헤더 누락 → 잡는다

### 기대값 fixture
- [ ] 성공 응답 형상 35 + 34개가 fixture로 추출됨
- [ ] 오류 계약 40종이 fixture로 추출됨. `practice_sessions.py:162`의 멀티라인 건 포함
- [ ] 멱등 전이표가 fixture로 추출됨
- [ ] fixture와 실제 소스가 어긋나면 실패하는 검증이 있다 (드리프트 방지)

### diff 리포터
- [ ] `openapi.json` 자기 자신과 비교 시 diff 0
- [ ] 위 7개 diff 유형을 각각 감지하는 단위 테스트

### 운용
- [ ] 스키마 격리로 시나리오 간 오염이 없다
- [ ] 레이트리밋에 걸리지 않는다 (60회/분)
- [ ] 실행 방법이 README에 있다
- [ ] `/health` 비교로 Java 백엔드와의 연결이 실제로 동작한다 (M0 산출물 대상)

## 검증 방법

```bash
# 자기 자신과 비교 — diff 0이어야 한다
python -m contract_harness --baseline fastapi --target fastapi

# 변조 버전과 비교 — 각 변조를 잡아야 한다
python -m contract_harness --self-test

# M0의 Java 스켈레톤과 /health 비교
python -m contract_harness --baseline fastapi --target java --only /health
```

## 미결 사항

- 두 백엔드를 띄우는 방식(프로세스 직접 기동 vs docker-compose) — 구현자가 정한다. 단 CI에서 돌릴 수 있어야 한다
- 시나리오 실행 시간 — 너무 길면 사이클마다 부담이다. 목표 5분 이내
