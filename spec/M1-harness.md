# M1 — 계약 동등성 하네스

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M1 사이클에만 적용된다.**

## 목적

빅뱅 전환이므로 **"기존과 똑같이 동작하는가"를 판정할 수단이 이것뿐이다.** M2 이후 모든 사이클의 완료 판정이 여기에 의존하므로 실제 이식보다 먼저 세운다.

M1 시점에 Java 쪽은 `/health`뿐이다. 따라서 **이 사이클의 검증은 "하네스가 옳은가"를 증명하는 것**이며, 방법은 §완료 기준에 정의한다.

## 위치·언어

- Python. `tools/contract-harness/` 아래.
- 기존 pytest 자산(픽스처·골든 데이터·토큰 발급)을 재사용한다.
- **M6에서 폐기한다**(검증 항목을 Java 테스트로 이관한 뒤). 영구 자산이 아니므로 과도한 추상화를 만들지 않는다.

## 아키텍처 — 독립 스키마 2개 + ID 정규화

### 왜 DB를 공유하면 안 되는가

두 백엔드를 같은 mutable 스키마에 붙이면, **먼저 실행한 쪽이 행을 만들고 나중 쪽은 생성 경로 대신 replay·충돌 경로를 탄다**(`store.py:667` 멱등키, `store.py:226` 등). 실제 구현 동등성을 비교하지 못한다.

반대로 아무 조치 없이 스키마를 분리하면 user·consent document·upload intent·practice session·summary의 UUID가 전부 달라져(`store.py:182`, `505`, `667`) diff가 무의미해지고, Python이 발급한 JWT의 `sub`가 상대 DB의 유저와 맞지 않는다(`auth/dependencies.py:24`).

### 채택 방식

1. **같은 seed를 복제한 독립 스키마 2개.** `db_test_support.py:25-51`의 `acting_test_<uuid>` 패턴을 빌려 스키마를 두 벌 만들고 동일한 시드를 넣는다
2. **시드가 만드는 ID는 고정한다** — 유저 UUID, 약관 문서 UUID. 이러면 토큰 하나가 양쪽에서 유효하다
3. **API가 런타임에 생성하는 ID는 symbolic으로 정규화한다.** `$practice_session_1`, `$coach_session_1` 같은 심볼로 치환해 비교하고, **후속 요청에는 각 백엔드가 실제로 반환한 ID를 쓴다.** 두 백엔드의 시나리오가 각자의 ID 공간에서 독립적으로 진행된다
4. 토큰은 **Python이 발급하고 양쪽이 소비**하는 단방향. `jwt.py:147`이 헤더를 `{"alg":"HS256","typ":"JWT"}`와 정확히 비교하므로 Java 라이브러리가 `kid`를 자동 추가하면 깨진다. `exp <= now`는 배타적 만료
   - **payload 키 정렬은 요구하지 않는다.** Python 디코더는 `json.loads`라 순서에 무관하다(`jwt.py:142`). M2가 Java 발급 토큰을 Python이 검증하는 방향까지 다룬다

### 3단 비교

| 층 | 대상 | 방법 |
|---|---|---|
| **L1 스키마** | 전 응답 | `openapi.json` 컴포넌트로 strict 검증. `additionalProperties: false`가 대부분 걸려 있어 필드 과부족이 즉시 잡힌다 |
| **L2 정규화 diff** | 전 응답 | 마스킹·symbolic 치환 후 JSON 구조 비교. **키 존재 여부까지** 비교 |
| **L3 바이트 동등** | 멱등 replay | **백엔드 간이 아니라 각 백엔드의 최초 응답 ↔ 자체 replay** |

**L3를 백엔드 간으로 잡으면 안 된다** — ID가 다르므로 애초에 바이트가 같을 수 없다. 검증하려는 계약은 "같은 요청을 두 번 보내면 바이트가 같다"(`sync_operations.py:147-155`의 canonical 인코딩)이므로, 각 백엔드 안에서 성립하면 된다.

**L3 대상** (기존 테스트가 명시적으로 바이트 동등을 요구하는 것 전부):
- `POST /v2/coach/start`, `/v2/coach/reply` (`test_response_contracts.py:635`, `659`)
- `POST /v2/reports` (`:682`)
- **`POST /v2/practice-sessions`** (`:505`, `:511`, `:521`)
- **`POST /v2/practice-sessions/{id}/analyze`** (`:550`, `:561`, `:571`)

**예외**: `SceneSummary`만 `additionalProperties: true`다(`practice_sessions.py:60`). 이 하위는 스키마가 아니라 **값 동일성**으로 비교한다 — 같은 stub LLM 응답 → 같은 JSONB → 같은 출력.

### 마스킹 대상

| 값 | 출처 |
|---|---|
| API 생성 UUID 전반 | symbolic 치환으로 처리(위 3번) |
| `access_token` / `refresh_token` | jti·iat·exp가 매번 다름 |
| `playback_url` / `upload_url` | presign 서명 |
| `created_at`/`updated_at`/`expires_at`/`occurred_at`/`published_at` | 시계 |
| `HealthResponse.commit` | `app.py:247` 환경변수 |

마스킹은 **값만** 지우고 **키와 타입은 검증**한다. `null`인지 문자열인지가 계약이다.

### LLM 스텁 — 봉합선 2개

실제 Gemini 호출은 3곳(`summarizer.py:136`, `agent/engine.py:51`, `report/engine.py:38`)이고 주입점은 `app.py:113`의 `create_app(client=...)` 하나다.

1. **동기 경로(coach/report)**: `generate_content` 레벨. `api_test_support.py`의 `COACH_QUESTION`(:43-46)·`COACH_FOLLOWUP`(:47-50)·`REPORT`(:52-65)를 **JSON 파일로 떠서 양쪽이 같은 파일을 읽게** 한다. 호출 순서가 곧 계약이므로 큐 순서를 고정한다
2. **비동기 경로(분석 워커)**: **`analyzer` 레벨**(`create_app(analyzer=...)`, `app.py:105`)로 자른다. 워커는 백그라운드가 아니라 **`run_once()` 동기 훅**으로 구동한다(`test_response_contracts.py:536`). Java에도 동등 훅이 필요하다 — M4 SPEC에 반영됨

## 기대값 소스

**숫자를 하드코딩하지 않는다**(`/SPEC.md` §6-2). 아래는 전부 **소스/OpenAPI에서 생성한 inventory**로 만들고, 집합 동등성으로 판정한다.

### ① 성공 응답 형상

`test_response_contracts.py`의 `SUCCESS_RESPONSE_MODELS`(:37-109)와 `RESPONSE_COMPONENT_SHAPES`(:111-272)를 기계 판독 가능한 fixture로 추출한다. 원본 테스트 파일은 건드리지 않는다.

### ② 오류 계약

`openapi.json`에 없다(`/SPEC.md` §6-2). 소스에서 `(method, path, 조건) → (status, detail)`을 추출한다.

주의: 공백 포함 문장과 snake_case가 섞여 있고, `/v2/practice-sessions` 409 `upload_intent_not_finalized_or_already_used`(`practice_sessions.py:162`)는 멀티라인이라 단순 grep에 안 잡힌다. 422 validation만 `detail`이 배열이다.

### ③ 멱등 전이표

`test_platform_v2.py:340-381` + `API.md:29-39`.

### ④ 조건부 라우트 — 별도 프로파일

admin 2개(`/admin/stats`, `/admin/sessions`)는 `ADMIN_OPS_TOKEN`이 있을 때만 등록된다(`app.py:250`, `admin.py:69`). **committed `openapi.json`에 아예 없다**(`spec/openapi.json:1764` 부근 확인).

→ `ADMIN_OPS_TOKEN`을 설정한 상태의 **별도 OpenAPI snapshot**을 만들고, admin 인증(토큰 없음 → 401)·nullable·presign fallback을 별도 시나리오로 둔다.

## 시나리오 — 전 영역 실행

`test_response_contracts.py:440-698`이 좋은 대본이지만 **커뮤니티·프로필·admissions를 실행하지 않는다**(`:691`에서 끝난다). 응답 스키마 선언만 맞고 실제 조회 필터·커서·익명 별칭·권한이 틀린 구현도 통과할 수 있다.

| 시나리오 | 내용 |
|---|---|
| **메인 플로우** | `:440-698` 번역 — 로그인 → 약관 → 업로드 → complete → 세션(202) → 워커 → 재분석 → 코치 → 리포트 → 이력·상세 → 삭제 → 로그아웃 |
| **커뮤니티** | 16개 경로 전부. 목록 커서(글 DESC / 댓글 ASC), 익명 별칭 번호, 차단 필터, 좋아요 카운트, 신고 중복, 조회수 증가 시점 |
| **프로필** | `/v2/me` GET·PATCH. nickname 정규화 |
| **admissions** | 공개 조회 2개 |
| **admin** (별도 프로파일) | 토큰 있음/없음, presign fallback |
| **상태코드** | `test_platform_v2.py`의 413/415·complete 멱등·소유권 404·error_code 파라미터화 |

### 게이트 둘을 셋업에서 처리

- **동의 게이트**(`auth/dependencies.py:84-93`): 미동의 시 전부 403. `POST /v2/consents` 선행. 약관 문서 UUID를 시드에서 고정하므로 양쪽이 같은 문서를 본다
- **레이트리밋**(`:70-81`): 유저당 60회/분 인메모리. **시나리오를 유저당 60회 미만으로 자르거나 유저를 늘린다**

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
  - [ ] `X-Request-Id` 응답 헤더 누락 → 헤더 검증
  - [ ] 커뮤니티 커서 방향 뒤집기 → 커뮤니티 시나리오
  - [ ] 조회수를 증가 **후** 값으로 반환 → 커뮤니티 시나리오

### 기대값 fixture
- [ ] 성공 응답 형상이 **소스에서 생성**된다 (하드코딩 아님)
- [ ] 오류 계약이 소스에서 생성된다. `practice_sessions.py:162` 멀티라인 건 포함
- [ ] 멱등 전이표 추출
- [ ] admin 프로파일용 별도 OpenAPI snapshot
- [ ] fixture와 실제 소스가 어긋나면 실패하는 드리프트 검증

### diff 리포터
- [ ] `openapi.json` 자기 자신과 비교 시 diff 0
- [ ] 8개 diff 유형을 각각 감지하는 단위 테스트

### 운용
- [ ] 두 스키마 시드가 동일하고 고정 UUID가 양쪽에서 같다
- [ ] symbolic ID 정규화가 동작하고, 후속 요청은 각 백엔드의 실제 ID를 쓴다
- [ ] 레이트리밋에 걸리지 않는다
- [ ] 시나리오 실행 5분 이내
- [ ] CI에서 실행 가능
- [ ] `/health` 비교로 Java 백엔드 연결이 실제로 동작한다 (M0 산출물 대상)

## 검증 방법

```bash
python -m contract_harness --baseline fastapi --target fastapi    # diff 0
python -m contract_harness --self-test                            # 변조 10종 감지
python -m contract_harness --baseline fastapi --target java --only /health
```

## 미결 사항

- 두 백엔드를 띄우는 방식(프로세스 직접 vs docker-compose) — 구현자가 정한다. CI에서 돌아야 한다
- symbolic ID 치환의 구현 형태 — 응답 본문뿐 아니라 후속 요청 경로·헤더에도 ID가 들어간다
