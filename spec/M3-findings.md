# M3 findings — 도메인 이관

`spec/M3-domain.md` 사이클의 결정·수용·기각 기록. 판정 근거는 `/SPEC.md`와 `spec/M3-domain.md`다.

## 이 사이클이 드러낸 것 — 사양이 틀렸던 자리

M3 는 **사양 자체의 오류를 다섯 곳 고쳤다.** 전부 "적어 두고 실행한 적 없는 것"이었고, 실제로 돌려 보고서야 드러났다(`/SPEC.md` §12-4).

| # | 사양이 적었던 것 | 실제 |
|---|---|---|
| 1 | 하네스 갭은 `JavaBackend.control` 과 `ScenarioContext.db` 둘 | **토큰 발급이 첫 관문**이었다. `tools/contract-harness/contract_harness/framework.py:ScenarioContext.token` 이 `backend.runtime` 을 읽어, 모든 시나리오가 첫 줄 `ctx.auth()` 에서 죽었다. 갭은 다섯이었다 |
| 2 | 제어 표면 선행분은 스키마 reset/seed·`db-projection`·`advance-clock` 셋 | **인증 provider 스텁과 S3 스텁도 선행분**이다. `spec/M1-harness.md` §④ 가 지목한 셋 중 둘이 M3 에 필요했고, LLM 하나만 M4 에 남는다 |
| 3 | M3 범위의 unknown key 허용은 `POST /v2/uploads/intents` 하나 | **`POST /v2/consents` 도 허용**이다. `/SPEC.md` §6-3 의 5개 중 M3 범위가 둘이었다. Codex 가 이 충돌을 보고했고, 더 구체적인 M3 지시를 따라 거부하도록 구현했다가 계약을 깰 뻔했다 |
| 4 | 그룹 3 판정은 `status-codes`·`inflight-replay` "일부" | **둘 다 M3 완주 불가.** 두 시나리오 모두 `run-worker-once`(M4 워커)를 호출한다 |
| 5 | 그룹 1 판정은 `profile`·`consent-gate` | **`consent-gate` 도 M3 완주 불가.** `/v2/coach/start` 와 `POST /v2/reports` 를 밟는데, 원본은 동의 게이트가 라우팅보다 먼저라 403 을 내고 Java 는 라우트가 없어 404·405 를 낸다 |

## 결정

### 결정 1 — 하네스가 토큰을 직접 발급한다

`spec/M1-harness.md` §채택 방식 4 는 원래 "Python 이 발급하고 양쪽이 소비"였는데 구현이 각 백엔드의 in-process `jwt_service` 를 읽는 쪽으로 드리프트해 있었다. 하네스가 `tools/contract-harness/contract_harness/config.py:JWT_SECRET` 으로 직접 HS256 을 만들어 양쪽에 같은 문자열을 준다. 헤더는 `{"alg":"HS256","typ":"JWT"}` 정확히 — `kid` 가 붙으면 `auth/jwt.py:JwtService._decode` 가 헤더 dict 를 통째로 비교해 거부한다.

### 결정 2 — 익명 별칭은 부모 행 락으로 재작성 (사용자 승인된 동작 변경)

`/SPEC.md` §3 은 datetime 외 동작 변경을 금지하지만 이것은 기록된 예외다. 원본의 SAVEPOINT + 3회 재시도는 `JpaTransactionManager` 가 `PROPAGATION_NESTED` 를 지원하지 않아 이식이 불가능하다. `community_posts` 행을 `FOR UPDATE` 로 잠가 글 단위로 직렬화하면 재시도 없이 같은 관찰 동작을 얻는다. 새 락이 만드는 경합은 검증 대상이므로 post update·delete 와의 교착 부재를 별도 연결 동시 실행으로 고정했고, 락 순서를 `/SPEC.md` §6 #11 에 덧붙였다.

### 결정 3 — OpenAPI 정합은 개별 애노테이션이 아니라 일반 메커니즘으로

pydantic 과 springdoc 은 같은 3.1 스펙을 여러 층에서 다르게 쓴다. 컴포넌트가 계속 늘어나는 구조라 `config/PydanticOpenApiCustomizer.java` 한 곳에 규칙을 모았다 — title 생성, `anyOf` nullable, 3.1 배타 경계, float 리터럴, 무한 `maxLength` 제거, `default` 타입 리터럴, enum `$ref`, 응답 content type, integer format, `ValidationError` 형상. `HealthAndBootIT` 가 도달 가능한 컴포넌트를 정본과 대조해 이 규칙들이 깨지면 잡는다.

## 허용된 계약 차이 — 확인 후 수용 (`/SPEC.md` §8-3)

### `admin_sessions` 의 N+1 을 고치지 않았다

`spec/M3-domain.md` "하지 말 것" 4 는 "고쳐도 된다(응답이 같다면), 단 기록한다"였다. **고치지 않는 쪽을 택했다** — 응답 동등성이 유일한 안전장치인데 M3 에는 이 경로를 밟는 하네스 시나리오가 없다(`admin` 시나리오는 `/v2/coach/start` 를 거쳐 M3 에서 완주 불가). 이득은 admin 화면 한 곳의 지연이고 위험은 계약 차이라 비대칭이다. M4 에서 `admin` 시나리오가 돌게 되면 그때 판단한다.

### `notices.json` 이 jar 에 포함된다

`build.gradle.kts` 가 `admissions/notices.json` 을 리소스로 굽는다. 파이썬은 환경변수로 경로를 바꿀 수 있었다. 계약에는 중립이지만 **M5 배포 시 차이**다 — 공고를 갱신하려면 재배포가 필요해진다. M5 에서 운영 절차를 정할 때 다시 본다.

### M0 산출물 일곱을 지웠다

`DeclarativeReportOperationService` 는 M0 가 `TransactionTemplate` 을 채택하며 기각한 쪽이고(`spec/M0-findings.md` E), `DuplicateReportDetector` 는 제약명 문자열 판정이라 `/SPEC.md` §6 #10 이 무효화했으며, 전용 예외 둘은 현재 원본이 `LeaseOwnershipError` 만 던져 대응물이 없다. `NaiveTransactionTrapIT` 두 건은 구 구조(수동 세션 + 커밋 예외를 트랜잭션 밖에서 캐치)의 함정 실증이라 대상이 사라졌다 — 다만 사양이 유지를 요구한 marker 롤백·단일 커넥션 재사용 검증은 `ReportOperationIT` 로 옮겨 살렸다.

## 실행 검증이 잡은 것 — Codex 는 테스트를 돌리지 못했다

M2 와 같은 전제였다. Codex 샌드박스가 gradle 락 파일과 로컬 소켓을 막아 **일곱 번의 위임 중 한 번도 `./gradlew test` 를 실행하지 못했고**, 매번 그 사실을 정직하게 보고했다. 실행 검증은 전부 Claude 쪽에서 이뤄졌으며, 그 과정에서 드러난 실패는 다음과 같다.

**단위 테스트가 잡은 것** — Flyway 부팅 데드락(풀 크기 1), 테스트 커넥션 고갈(캐시된 컨텍스트마다 풀 유지), `@Repository` 예외 변환 두 건, 존재하지 않는 enum 타입 캐스팅, 잘못된 `turn_role` 값, `source_handoff_id` NOT NULL 누락, 문자열 `formatted` 결합 오류.

**하네스만 잡을 수 있었던 것** — 인증 provider 스텁 부재, S3 스텁 부재, `value_error` 의 `ctx.error` 형상, OpenAPI 3.1 표기 여섯 층, 잘못된 커서의 500.

**Codex 최종 관문이 잡은 것** — **공개 경로에 만료 토큰을 붙이면 401 이 났다.** `consents.py:build_router.list_documents` 와 `admissions.py:build_router` 는 인증 의존성이 **아예 없어** Authorization 헤더를 읽지도 않는데, `auth/AccessTokenFilter.java` 는 "헤더가 있으면 검증"이라 만료 토큰을 전역으로 붙이는 클라이언트가 약관·입시 정보에서 401 을 받았다(실측 재현). 커뮤니티 읽기는 다르다 — `auth/dependencies.py:build_optional_user_dependency` 가 토큰이 있으면 검증하고 실패 시 401 을 내므로 기존 동작이 맞다. 그 밖에 `PythonText` 가 U+0085(NEXT LINE)를 빠뜨린 것과, 쿼리 정수 파싱 실패가 `int_parsing` 이 아니라 Spring 내부 메시지로 나가던 것(`loc` 도 `query` 가 아니라 `path` 였다)을 고쳤다.

**리뷰가 잡은 것** — **동의 게이트 누락**이 가장 컸다. `app.py` 는 라우터마다 같은 이름의 파라미터에 다른 의존성을 넣는다. `practice`·`uploads`·`reports`·`coaching` 은 `rate_limited_user` 자리에 `consented_user` 를 받는데, 라우터 소스만 보면 `rate_limited_user` 라고 적혀 있어 구분되지 않는다. 그 결과 `/v2/practice-sessions` 와 `/v2/reports` 가 동의 없이 열려 있었다. 삭제만 `ungated_user`(레이트리밋만) 인 것까지 맞췄다. 그 밖에 NBSP strip 차이, 댓글 목록의 오류 우선순위 역전(Claude 가 만든 회귀), admin 이 일반 토큰 필터를 타던 문제.

## 판정 결과

- Java 테스트 **171개, 실패 0**
- 하네스 **openapi diff 0**
- 시나리오 diff 0: `profile` · `expired-intent` · `community` · `community-traversal` · `admissions`
- `consent-gate` 는 4건 잔여 — 전부 M4 라우트 미존재 탓이며 위 표 #5 에 기록

## 남은 것 (M4 로 넘김)

- `status-codes`·`inflight-replay`·`main-flow`·`admin`·`reanalyze`·`concurrency` 등 워커·coach 를 밟는 시나리오
- 제어 표면 `run-worker-once`·`run-sweep`·`stub-state`
- `openapi.json` **전체** diff 0 (M3 는 M3 inventory slice 로 판정)
- `auth/FixedWindowRateLimiter` 의 `advanceContractClock()`·`reset()` 이 프로덕션 `@Component` 의 공개 메서드다. contract 프로파일 전용 훅이므로 가시성을 좁히거나 프로파일로 가른다

### 🔎 요청 검증을 캐시된 JSON 트리 기반으로 바꾼다 — 한 덩어리로 다룰 것

Phase 5·6 리뷰가 **같은 뿌리에서 나온 지적 다섯**을 냈다. 개별로 고치면 부분해가 되고 서로를 무효화하므로 M4 착수 시 한 번에 처리한다.

1. **422 가 오류를 하나만 담는다.** pydantic 은 필드 오류를 전부 모아 내는데 Java 는 순차 검증이라 첫 건에서 멈춘다. 빈 title+body 는 원본이 **2건**을 낸다(실측). `community.py:PostWriteRequest`, `practice_sessions.py` 의 literal 두 필드, community 신고의 `target_type`·`reason` 이 모두 해당한다
2. **명시적 `null` 과 생략을 구분하지 못한다.** `anonymous` 가 primitive `boolean` 이라 Jackson 이 `null` 을 `false` 로 바꾼다 — 원본은 `bool_type` 422 다(실측). `@NotNull` 위반을 전부 `missing` 으로 분류하는 것도 같은 문제로, 원본은 명시적 null 에 `string_type` 을 낸다
3. **`literal_error` 를 `enum` 으로 낸다.** 판별자 자체가 다르다
4. **게이트가 바디 검증보다 늦게 돈다.** Spring 은 `@Valid @RequestBody` 를 메서드 진입 전에 평가하는데 FastAPI 는 `Depends` 를 먼저 푼다. 미동의·미인증·레이트리밋 상태에서 잘못된 바디를 보내면 Java 422 · Python 403/401/429 로 갈린다
5. 위 넷은 **요청 바디를 DTO 로 바인딩하기 전에** 캐시된 JSON 트리를 순회하며 "존재 여부·타입·누적"을 판정하고, 라우트별 인증·레이트리밋·동의 정책을 그 앞에 두는 구조라야 한꺼번에 풀린다. `web/RequestBodyCachingFilter` 가 이미 원본 바디를 들고 있어 토대는 있다

**M3 에서 손대지 않은 이유**: 이 구조 변경은 모든 요청 경로를 지나가므로, 하네스 diff 0 을 달성한 직후에 넣으면 무엇이 깨졌는지 가리기 어렵다. M4 는 어차피 coach·reports 라우트를 새로 열어 422 경로를 다시 건드린다.

### 🔎 lease 전이표의 나머지 — `claim_next` 만 있다

Codex 적대적 리뷰가 high 로 올렸다. `/SPEC.md` §5-7 은 claim·complete·fail·release·sweep 다섯 상황을 규정하는데 `operation/ExternalOperationClaimer.java` 는 claim-next 하나뿐이고, claim-by-id·fail·release·max-attempts sweep 의 Java 대응물이 없다. M3 완료 기준 문언("analyze claim 이 operation 과 practice session 을 한 트랜잭션에서 전이")은 충족했지만 전이표 전체는 아니다.

**M4 로 넘긴다** — 이들의 유일한 호출자가 분석 워커이고(`analysis_worker.py:AnalysisWorker.run_once`), 지금 만들면 사용처 없는 코드가 된다. 다만 M4 에서 워커보다 **먼저** 저장 계층을 세우고 §5-7 다섯 행을 각각 Testcontainers 로 고정한다 — `release` 가 `attempt_count` 를 되돌리지 않는 것과 3회 소비 후 sweep 이 `FAILED` 로 넘기는 것이 특히 응답에 드러나지 않는다.

## M3 종료 직후 흡수한 dev 전진분 — 그리고 남은 것

M3 를 닫자마자 `origin/dev` 가 31파일·1061줄 전진해 있었고, 그중 둘이 M3 이식분을 낡게 만들었다. `/SPEC.md` §11 이 경고한 상황이라 M4 착수 **전에** 흡수했다.

### 흡수 완료

| 변경 | 처리 |
|---|---|
| `SOMA-306` 탈퇴 — `user_status_t` 에 `deactivated`, `users.deactivated_at` (`0011_user_deactivation`) | `V1__baseline.sql`·fingerprint 는 **SOMA-306 브랜치가 이미 재생성해 뒀다**(`819ddd7`). `apps/api-java/CLAUDE.md` 의 "스키마가 바뀌는 PR 마다 regen-baseline.sh" 규칙이 지켜져 스키마 테스트가 그대로 통과했다 |
| **인증 게이트의 `deactivated` 403** | `auth/CurrentUserService.java` 가 `SUSPENDED` 만 보고 있었다. 탈퇴는 행을 남기고 상태만 바꾸므로 **이미 발급된 액세스 토큰이 만료까지 유효**한데, 그것을 막는 것이 이 게이트뿐이다 — 빠뜨리면 탈퇴 계정이 토큰 수명 동안 API 를 계속 쓴다 |
| **`DELETE /v2/me`** | 행을 남기고 이메일·닉네임·identity 를 파기하고 refresh 를 전량 끊는다. 상태 전환·파기·토큰 폐기를 **한 트랜잭션**에 묶었다(나누면 "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다). 재탈퇴 시 최초 시각 유지 |

### 🔎 아직 흡수하지 않은 것 — `/v2/admin/stats` 지표 확장

`c8ce457 운영 지표에 어제(KST)·퍼널 단계·종료 사유 전체를 더한다` 가 `admin.py:AdminStats` 를 크게 늘렸다. Java 는 M3 시점 형상(26필드)에 머물러 있고, 원본에는 그 밖에 `users_yesterday`·`active_users_yesterday`·`funnel_steps`·`close_reasons`·`gap_stated_*`·`db_size`·`observations_total`·`observations_per_summary`·`last_signup_at`·`last_session_at` 등이 있다.

**하네스가 잡지 못한다** — admin 2개는 `ADMIN_OPS_TOKEN` 이 있을 때만 등록돼 committed `openapi.json` 에 아예 없고(`/SPEC.md` §6-2), `admin` 시나리오는 `/v2/coach/start` 를 거쳐 M3 에서 완주 불가다. 즉 **`AdminEndpointIT` 가 초록이어도 낡은 채로 통과한다.** M4 착수 시 `admin.py:AdminStats` 와 필드 단위로 대조해 맞추고, admin 프로파일 inventory 를 committed 스펙이 아니라 **소스에서** 생성하는 판정을 세운다.

## Codex 스레드

- 그룹 0: `019fdf27-2700-7c90-98e8-2c0c9b7a1ea9`
- 그룹 A-1: `019fdf37-10d5-7603-9784-e48c1c220cf0`
- 그룹 A-2: `019fdf4a-d316-7712-9ca5-c7c638ddb4ce`

이어가려면 `codex resume <thread-id>`.
