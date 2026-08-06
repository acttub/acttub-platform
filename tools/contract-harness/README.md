# contract-harness — M1 계약 동등성 하네스

FastAPI(`apps/api`)와 Spring Boot(`apps/api-java`)가 **같은 계약을 재현하는지**를
판정하는 도구다. 사양은 `/SPEC.md` + `spec/M1-harness.md`이고, **M6에서 폐기한다**
(검증 항목을 Java 테스트로 이관한 뒤). 영구 자산이 아니므로 추상화를 늘리지 않는다.

## 실행

`apps/api`의 uv 워크스페이스 가상환경을 그대로 쓴다(새 의존성을 들이지 않는다).

```bash
cd apps/api && uv sync            # 최초 1회
cd tools/contract-harness

PY=../../apps/api/.venv/bin/python

$PY -m contract_harness --baseline fastapi --target fastapi   # diff 0
$PY -m contract_harness --self-test                           # 변조 감지 전량
$PY -m contract_harness --baseline fastapi --target java --only /health \
    --java-base-url http://127.0.0.1:8099
$PY -m contract_harness --coverage                            # 미실행 operation 보고
$PY -m contract_harness --check-manifest                      # AST inventory ↔ manifest
$PY -m contract_harness --openapi-diff a.json b.json          # diff 리포터 단독
$PY -m contract_harness --dump-inventory inventory            # 기대값 fixture 재생성
$PY -m pytest tests -q                                        # 리포터·정규화 단위 테스트
```

- DB: `HARNESS_DATABASE_URL`(기본 `postgresql://acttub:acttub@localhost:55432/harness_claude`).
  `harness_baseline`·`harness_target` 스키마 두 벌을 만들어 alembic head까지 올린다.
  실행 사이에는 TRUNCATE + 재시드로 되돌린다(`--rebuild-schemas`로 강제 재생성).
- 앱 로그는 기본으로 끈다. `HARNESS_LOGS=1`이면 그대로 보여준다.

## 구조

| 파일 | 역할 |
|---|---|
| `dbsetup.py` · `seed.py` | 독립 스키마 2벌 + 동일 시드(고정 UUID) |
| `wrapper.py` | `create_app(...)`을 감싸는 ASGI 래퍼 + 제어 표면 5개 |
| `stubs.py` | LLM·S3·인증 provider·시계 스텁 (값은 `fixtures/*.json`) |
| `backends.py` | fastapi(in-process) / java(base URL) 어댑터 |
| `normalize.py` | symbolic ID · opaque 값 정책 · datetime 검증→마스킹 |
| `compare.py` | L1 스키마 · L2 정규화 diff · L3-a/L3-b · 헤더 |
| `jsonschema_lite.py` | OpenAPI 컴포넌트용 최소 검증기(외부 의존 없음) |
| `inventory.py` | 기대값을 **소스/OpenAPI에서 생성** (하드코딩 금지) |
| `manifest.py` | 오류 계약 실행 manifest + 명시적 제외 사유 |
| `openapi_diff.py` | 전체 문서 semantic diff 리포터 |
| `mutations.py` | 변조 27건 (self-test) |
| `scenarios/` | 시나리오 21개 |

## 백엔드가 만족해야 하는 계약

하네스가 백엔드에 요구하는 것은 HTTP 표면과 **제어 표면 5개**뿐이다. 그 뒤를 어떻게
구현하는지는 백엔드별 자유다. 경로는 `POST /__harness/<name>`, 바디는 JSON이다.

| 제어 | 의미 |
|---|---|
| `run-worker-once` | 분석 워커를 1틱 돌리고 처리한 operation 수를 돌려준다 |
| `run-sweep` | max-attempts 소진분을 최종 실패로 넘긴다 |
| `stub-state` | LLM·S3·인증 스텁의 호출 횟수와 잔량 |
| `advance-clock` | 주입 시계를 N초 전진 |
| `db-projection` | 도메인 객체의 정규화된 DB 상태 |

**contract 프로파일에서 자동 워커는 뜨지 않는다.** 시간 경과에 의존하는 동작은
전부 `advance-clock`으로만 일어난다. 이 표가 곧 M4에 넘기는 요구사항이다
(`spec/M4-llm.md`).

## 시간·중간 상태를 결정적으로 만드는 두 장치

시계를 앞당기지 않고도 "만료됐다"·"처리 중이다"를 재현한다.

**① 스텁 게이트** (`stubs.py:STUB_BLOCK_MARKER`). 프롬프트에 `[[stub:block]]`이 있으면
LLM 스텁이 신호가 올 때까지 멈춘다. `coaching.py:build_router.coach_start`는
`begin_sync_operation`으로 클레임을 잡은 **다음** `coach_engine.start(generate=...)`를
부르므로, **스텁이 멈춰 있는 동안 그 operation은 running이다.** 하네스는 `stub-state`로
멈춘 것을 확인한 뒤에만 다음 단계로 가므로 인터리빙에 의존하지 않는다. 해제는
`stub-state`의 payload(`{"release": true}` / `{"rearm": true}`)로 한다 — 제어를 6개로
늘리지 않으려고 기존 제어에 넣었다. 게이트에는 20초 상한이 있어 신호를 못 받아도
매달리지 않고 실패로 보고된다.

**② 이름 붙은 DB 조작** (`dbops.py`). `db-projection`이 이미 그렇듯 하네스는 대상
스키마에 직접 붙는다. 만료 판정은 시계가 아니라 DB 값을 보므로
(`uploads.py:build_router.complete_intent`의 `intent.expires_at <= now`), 발급된 행을
과거로 UPDATE하면 만료가 결정적으로 만들어진다. lease 탈취·리포트 행 삭제·handoff에
마커 주입도 같은 방식이다. 임의 SQL은 노출하지 않는다 — 조작마다 이름과 인자가
고정돼 있어야 Java 백엔드에도 같은 형태로 옮길 수 있다.

## 알려진 한계

- `advance-clock`은 레이트리밋 monotonic 시계와 워커 호출에 넘기는 wall clock만
  움직인다. 앱 내부의 `datetime.now(timezone.utc)`에는 주입점이 없다. 그래서 시각에
  의존하는 계약은 위 ②처럼 **DB 값**을 바꿔 재현한다.
- 동시성 시나리오는 인터리빙과 무관한 **불변식만** 기록한다. 응답 하나하나를 비교하면
  같은 시드로 반복 실행할 때 결과가 흔들린다.
- 스텁 게이트와 DB 조작을 쓰는 시나리오(`inflight-replay`·`lease-stolen`·
  `expired-intent`)는 백엔드의 스키마 이름을 알아야 한다. M1 시점 java 어댑터에는
  스키마가 없어 이 시나리오는 fastapi 전용이며, 실행하면 명시적으로 중단된다.
