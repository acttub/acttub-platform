# M3 — 도메인 이관

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M3 사이클에만 적용된다.**

> **상세화 시점**: M0·M2의 findings가 나온 뒤 사이클 진입 시 그룹별로 보강한다. 지금 확정된 것은 범위·순서·위험 지점·완료 기준이다.

## M2가 이미 깔아 둔 것 — 다시 만들지 않는다

M3는 **엔드포인트만 얹는다.** 아래는 `spec/M2-findings.md`에서 확정돼 테스트로 고정됐다:

| 기반 | 상태 |
|---|---|
| 엔티티 24개 · enum 컨버터 17개 · JSONB `JsonNode` | `ddl-auto: validate` 통과, 4케이스 왕복 고정 |
| 422 계약 변환 | 예외별 type(`extra_forbidden`·`int_parsing`·`int_from_float`·`uuid_parsing`·`enum`·`string_type`·`missing`·`json_invalid`), 중첩 경로 전량 순회 + wire 이름 변환, 배열 index, 거부값 `input`, `ctx` |
| **숫자 파싱**(`12.0`→201 / `12.5`→422) | `ExactIntegerDeserializer`로 해결. **M3 그룹 2의 위험 목록에서 뺀다** |
| unknown key | 전역 `fail-on-unknown-properties: true` + 허용 DTO에만 `@JsonIgnoreProperties`. M3의 `/v2/practice-sessions`·`/v2/uploads/intents`는 **허용 집합**이므로 애노테이션을 붙인다 |
| 오류 포맷 | `{"detail": <str>}`, 404·405·인증 필터에서 `ProblemDetail` 미노출 |
| 시계 · `SKIP LOCKED` | policy matrix 확정, `SKIP LOCKED` 미도입(원본 경합 순서 보존) |
| JWT · 레이트리밋 2종 · consent 게이트 | 완료. M3는 `consented_user` 조합을 쓰기만 한다 |

M3에서 새 DTO를 만들 때 **422 형상과 unknown key 정책이 자동으로 따라오는지 확인**한다 — M2의 변환기는 루트 DTO 하드코딩이 아니라 Jackson introspection 기반이라 원칙적으로 따라오지만, 중첩·컬렉션 DTO가 M3에서 처음 등장하므로 실제로 확인한다.

## 목적

LLM에 의존하지 않는 엔드포인트를 이식한다. **`db/store.py` 2,118줄 + `community_store.py` 749줄이 실제로 옮겨지는 구간**이며 가장 긴 사이클이다.

## 범위 — LLM 경로는 전부 M4

`/v2/coach/*`(2개)와 **`POST /v2/reports`**는 **OpenAI**를 호출하므로(`coaching.py:build_router.coach_reply`, `reports.py:build_router.create_report` → `acting-llm/openai_client.py:generate_text`) M3에서 구현할 수 없다. M3에서는 **저장 계층만** 만들고 엔드포인트 노출은 M4가 한다.

이 때문에 **M3의 완료 기준은 "하네스 전량 통과"가 아니라 "구현된 path 집합에 대한 통과"다.** 전 플로우 시나리오는 coach·report 생성을 거치므로 M3에서는 구조적으로 완주할 수 없다. 전량 통과는 M4에서 처음 관문이 된다.

## 순서

의존이 적은 것부터. 각 그룹이 끝날 때마다 해당 path에 대해 하네스를 돌린다.

| # | 그룹 | 주된 위험 |
|---|---|---|
| 1 | `/v2/me`, `/v2/consents` | `DISTINCT ON` 3건(`db/store.py:PostgresStore.list_latest_consent_documents`·`.get_current_user_consents`·`.total`), nickname 정규화 |
| 2 | `/v2/uploads` | `UPDATE...RETURNING`, presign 리전 고정, unknown key 허용 (숫자 파싱은 M2에서 해결됨 — 회귀 테스트만 확인) |
| 3 | `/v2/practice-sessions` | **위험 함수 #2**, 조건부 키 생략, 멱등 전이표, L3 바이트 동등 |
| 4 | `/v2/community` (16) | `community_store.py` 749줄. **위험 함수 #5**, 키셋 커서, 차단 필터, 익명 별칭 |
| 5 | `/v2/reports` **GET 2개만** | 목록·상세. `POST`는 M4 |
| 6 | `/v2/admissions`, `/admin` | 조건부 LEFT JOIN, `admin_sessions`의 N+1(`db/store.py:PostgresStore.admin_sessions`), admin은 조건부 등록 |

**엔드포인트 개수를 완료 조건으로 쓰지 않는다**(`/SPEC.md` §6-2). inventory 집합 동등성으로 판정하고, admin은 별도 프로파일 inventory를 쓴다.

## 위험 함수 — 그룹보다 먼저 처리

`/SPEC.md` §7-1. 각각을 **먼저 프로토타입 + Testcontainers 테스트로 고정**한 뒤 해당 그룹을 이식한다.

1. **`db/store.py:PostgresStore.complete_practice_report_operation`** — M0에서 확정한 트랜잭션 스타일 적용. **엔드포인트는 M4지만 저장 계층은 여기서.**

   ⚠ **초판은 `complete_report_operation`과 제약명 `reports_session_id_key`를 지목했다. 둘 다 존재하지 않는다.** `SOMA-302`가 리포트 계층을 `practice_reports`로 옮기면서 함수는 재작성됐고, 멱등은 `uq_practice_reports_source_handoff`에 대한 **`ON CONFLICT (source_handoff_id) DO NOTHING RETURNING`** 으로 바뀌어 **제약명 문자열을 보지 않는다**(`/SPEC.md` §6 #10). 따라서 "사전 존재 확인 경로 vs 커밋 시 위반 경로"를 나눠 테스트할 대상 자체가 없다. 산문이라 `check-refs.py`가 잡지 못한 자리다.

   실제 구조는 이렇다 — 삽입이 충돌하면 `RETURNING`이 비어 `False`를 돌려주고, 삽입에 성공하면 `_finish_external_operation`이 lease 소유를 확인해 **잃었으면 `LeaseOwnershipError`로 방금 넣은 리포트까지 함께 롤백**한다.

   고정할 것:
   - 같은 `source_handoff_id` 재요청이 `False`를 받고 **새 행이 생기지 않는다**
   - lease를 빼앗긴 상태의 완료 시도가 **삽입된 리포트까지 롤백**한다
   - **M0의 트랜잭션 검증은 대상만 갈아 그대로 유지한다** — 같은 트랜잭션에서 성공하는 marker write를 먼저 한 뒤 실패를 일으켜 marker가 롤백되는지, 커넥션 풀을 1로 묶어 같은 커넥션에서 즉시 새 트랜잭션이 성공하는지(Postgres 가 aborted 로 남지 않음). 결론은 유효하고 대상 함수만 바뀌었다
   - **M0 산출물 `ReportOperationIT`(13개)는 옛 구조를 프로토타이핑한 것이다**(`/SPEC.md` §7-1 "강등"). 새 함수 기준으로 재조준한다
2. **`create_practice_session_with_analysis_operation`** — 보상 로직(`db/store.py:PostgresStore.create_practice_session_with_analysis_operation`). 유사 구조가 `db/store.py:PostgresStore.create_analysis_retry_operation`에 복제되어 있으므로 **둘을 함께** 본다
3. **`_save_coach_session` + `_load_session`** — `FOR SHARE OF` + 턴 전량 값 비교. 저장 계층만
   - 🔁 `SOMA-304`로 코치 저장 계층에 셋이 붙었다: 신규 `db/store.py:PostgresStore.get_oldest_open_coach_session`(`created_at, id` 순 + `hidden_at IS NULL` + 소유권 조인), `.complete_coach_start_operation`의 `restart` 인자(같은 연습 세션의 열린 코치 세션을 일괄 `closed` 전이), 그리고 응답에 실리는 턴 전량(`coaching.py:PublicCoachTurn`). **정렬 기준과 일괄 전이 범위가 곧 계약이다**
4. **`claim_next_external_operation`** — 워커는 M4가 쓰지만 저장 계층은 여기서. lease 전이표(`/SPEC.md` §5-7)를 그대로 구현한다
5. **`_ensure_alias`** — 아래 별도 항목

### 위험 함수 #5 — alias 발급 재작성

`community_anonymous_aliases`에는 unique 제약이 **둘** 있다(`db/models.py:CommunityAnonymousAlias`):
- `uq_community_alias_post_user` (post_id, user_id)
- **`uq_community_alias_post_ordinal` (post_id, ordinal)**

따라서 `INSERT ... SELECT MAX(ordinal)+1 ... ON CONFLICT (post_id, user_id) DO NOTHING`은 **부족하다.** 서로 다른 사용자가 동시에 같은 ordinal을 고르면 `(post_id, ordinal)` 위반으로 **댓글 트랜잭션 전체가 실패**한다. 또한 같은 사용자의 충돌에서 `DO NOTHING RETURNING`은 기존 ordinal을 반환하지 않는다.

**채택 방식**: 부모 `community_posts` 행을 `FOR UPDATE`로 잠근 뒤 → 기존 alias 조회(있으면 그 ordinal 반환) → 없으면 `MAX(ordinal)+1` 삽입. **post 단위로 할당을 직렬화**하므로 SAVEPOINT도 재시도 루프도 필요 없다.

원본은 SAVEPOINT + 3회 재시도였으나(`db/community_store.py:CommunityStore._ensure_alias`) `JpaTransactionManager`가 `PROPAGATION_NESTED`를 지원하지 않고 Hibernate가 제약 위반 후 세션 재사용을 보장하지 않으므로, **이식이 아니라 재작성이 유일한 답이다.** 관찰 가능한 동작(같은 사용자는 같은 번호, post 안에서만 유효, 번호는 1부터 연속)은 동일하게 유지한다.

`RuntimeError`로 전체 롤백하던 실패 경로가 사라지는 것이 유일한 차이이며, 이는 개선이다.

## 커뮤니티 — 놓치기 쉬운 관찰 가능 동작

| 항목 | 실제 동작 | 근거 |
|---|---|---|
| **차단 필터** | `anonymous = true OR author_id NOT IN blocked` — **익명 글은 숨기지 않는다.** 숨기면 차단 전후 비교로 익명 신원을 추론할 수 있다 | `db/community_store.py:_not_blocked` |
| **조회수** | 상세 조회 응답은 **증가 전** `view_count`를 반환한다. 증가는 별도 원자 연산 | `community.py:build_router.get_post` |
| **입력 정규화** | title·body는 trim. **nickname은 내부 공백까지 접는다** | `community.py:_trimmed`, `profile.py:UpdateMeRequest` |
| **키셋 커서** | 글 목록 DESC(`:261-270`) / 댓글 목록 **ASC**(`:568-577`) — 방향이 반대다. base64 인코딩(`:133-146`)까지 그대로 | |
| **좋아요** | 재집계. 증감으로 되돌리지 않는다 | `/SPEC.md` §7-1 |
| **댓글 수** | 원자적 증감. 벌크 UPDATE + 캐시 무효화 | `/SPEC.md` §7-2 |
| **읽기 공개** | 토큰 없이 200 | `/SPEC.md` §6 #16 |

차단 필터는 3곳에서 재사용되므로(`:260`, `:332`, `:567`) Spring에서도 재사용 가능한 형태(`Specification`)로 만든다.

## 완료 기준 체크리스트

- [ ] LLM 비의존 엔드포인트 전부 이식 (inventory 집합 동등성으로 판정)
- [ ] 위험 함수 5개가 각각 Testcontainers 테스트로 고정됨
- [ ] **하네스가 구현된 path 집합에 대해 통과** — L1/L2/L3. 전량 통과는 M4
- [ ] L3 바이트 동등: `POST /v2/practice-sessions`, `POST /v2/practice-sessions/{id}/analyze` (각 백엔드의 최초↔replay)
- [ ] 오류 계약이 구현 범위 안에서 status·detail까지 일치
- [ ] `openapi.json` diff 0 (datetime 통일 제외, admin은 별도 프로파일)
- [ ] 조건부 키 생략 재현 (`summary`/`error_code`)
- [ ] 멱등 전이표 4케이스 통과
- [ ] `X-Request-Id` 응답 헤더 반환
- [ ] v1 경로 5개 404 — 🔁 `SOMA-318`이 `acting-agent`·`acting-summary`·`acting-report`의 자체 라우터를 **삭제**해 근거가 "마운트되지 않음"에서 "라우터가 없음"으로 바뀌었다. 하네스도 해당 `EXCLUSIONS`를 지웠다(`tools/contract-harness/contract_harness/manifest.py`). 계약(`/SPEC.md` §6 #14)은 그대로 유효하다
- [ ] unknown key 허용 대상(`/v2/practice-sessions`, `/v2/uploads/intents`)이 422를 내지 않는다
- [ ] 커뮤니티: 차단 필터가 익명 글을 숨기지 않는다 / 조회수는 증가 전 값 / nickname 내부 공백 접힘 / 커서 방향 정확
- [ ] 동시성: 세션 생성 경합, 재분석 경합, lease 경합 (`tests/test_db_store.py:test_concurrent_practice_creation_replays_the_winning_operation`·`:test_external_operation_idempotency_lease_race_and_atomic_completion` 대응)
- [ ] alias: 동시 익명 댓글 2건이 서로 다른 번호를 받고 **댓글이 실패하지 않는다**
- [ ] Java가 더 엄격해져 생긴 diff는 **확인 후 수용**으로 기록됨 (`/SPEC.md` §8-3)

## 하지 말 것

1. `/v2/coach/*`, `POST /v2/reports` 엔드포인트 노출 금지 — M4
2. LLM 호출 코드 작성 금지 — M4
3. **완료 기준에 개수를 하드코딩하지 않는다**
4. `admin_sessions`의 N+1은 **고쳐도 된다**(응답이 같다면). 단 기록한다
5. 기존 `apps/api` 수정 금지
6. 스코프 밖 리팩터링 일체
