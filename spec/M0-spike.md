# M0 — 스파이크

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M0 사이클에만 적용된다.**

## 목적

이후 마일스톤의 SPEC을 확정 가능한 상태로 만든다. **M0은 "기능을 만드는" 사이클이 아니라 "미지수를 없애는" 사이클이다.** 지금 `/SPEC.md` §10에 남아 있는 미결 사항 중 M0 몫 두 개를 사실로 바꾸고, 나머지 마일스톤이 올라탈 최소 골격을 세운다.

여기서 나온 결론은 `spec/M0-findings.md`에 기록하고, 그 결과로 M1~M6 SPEC을 조정한다.

## 산출물

### A. Gradle 스켈레톤 — `apps/api-java/`

- Gradle Kotlin DSL + **wrapper**(로컬에 Gradle CLI가 없다), Spring Boot 3.4, Java 21
- **virtual threads 활성화** (`spring.threads.virtual.enabled=true`)
- 의존성: `spring-boot-starter-web`, `-data-jpa`, `-validation`, `flyway-core`, `flyway-database-postgresql`, `postgresql`, `springdoc-openapi-starter-webmvc-ui`, `nimbus-jose-jwt`, AWS SDK v2 `s3`, 테스트에 `spring-boot-starter-test` + `testcontainers-postgresql`
- Jackson 설정을 **이 단계에서 못 박는다**: `WRITE_DATES_AS_TIMESTAMPS=false`, `FAIL_ON_UNKNOWN_PROPERTIES=true`, `@JsonInclude(NON_NULL)` 미사용, datetime `Z` + 마이크로초 6자리 (`/SPEC.md` §4)
- `bootJar`가 실행 가능한 단일 jar를 만든다

### B. `/health` 엔드포인트

기존 계약과 동일한 형상을 낸다 (`apps/api/acting-api/src/acting_api/app.py:236-248`):

```json
{"status": "ok", "services": ["summary", "coach", "report"], "model": "<모델명>", "keep_alive": false, "commit": "unknown"}
```

`HealthResponse.status`는 `const: "ok"`이고 `additionalProperties: false`다. springdoc이 이 형상을 그대로 내는지 확인하는 것이 목적이므로, 나머지 값은 설정에서 읽되 형상은 정확히 맞춘다.

### C. Gemini Java 스파이크 — **가장 중요**

`/SPEC.md` §10의 첫 미결 사항을 해소한다. 검증할 3가지:

1. **Files API 업로드** — 영상 파일 업로드 (`client.files.upload` 대응)
2. **`PROCESSING` 상태 폴링** — ACTIVE가 될 때까지 대기, 타임아웃 처리 (`summarizer.py:19-32` 대응)
3. **구조화 출력** — `responseSchema`로 `SceneSummary` 형상을 강제하고 파싱

**판정**: Google GenAI Java SDK로 셋 다 되면 SDK 채택. 하나라도 막히면 `RestClient`로 REST 직접 호출하는 경로를 프로토타이핑하고 그쪽으로 확정한다. **결론을 findings에 명시**한다 — M4 전체가 이 결정 위에 선다.

실호출에 `GEMINI_API_KEY`가 필요하다. `apps/api/acting-api/.env`에 있다. 영상은 짧은 샘플이면 충분하다.

### D. Flyway baseline 검증

기존 스키마를 **건드리지 않고** baseline이 붙는지 확인한다.

1. 로컬 Postgres에 alembic으로 만든 스키마를 준비한다 (`db_test_support.py:25-51`의 `acting_test_<uuid>` 패턴 또는 별도 DB)
2. Flyway `baselineOnMigrate` + `baselineVersion`으로 그 스키마를 기준선으로 잡는다
3. Hibernate `ddl-auto: validate`가 통과하는지 확인 — **여기서 엔티티를 다 만들 필요는 없다.** 1~2개 테이블(예: `users`, `practice_sessions`)만 매핑해 검증 경로가 성립하는지 본다
4. **부분 인덱스 3개와 CHECK 제약이 validate를 방해하지 않는지** 확인 (`/SPEC.md` §5-3-6)

### E. 위험 함수 #1 트랜잭션 프로토타입 — **이중 구현의 핵심 대상**

`complete_report_operation`(`apps/api/acting-api/src/acting_api/db/store.py:1580-1643`)을 Java로 재현한다.

원본 구조:
```python
db = self._session_factory()          # 수동 세션 생성
try:
    with db.begin():                  # 트랜잭션 시작
        ... FOR UPDATE, 존재 확인, _add_report, flush, _finish_external_operation
        return payload                # with 종료 시 COMMIT
except IntegrityError as exc:         # 커밋 중 예외를 트랜잭션 '밖'에서 캐치
    if self._is_duplicate_report_error(exc): return None   # 정상 응답으로 변환
    raise
finally:
    db.close()
```

Spring `@Transactional`은 커밋이 메서드 리턴 **이후**라 내부 try/catch로 이 예외를 잡을 수 없다. 세 시나리오가 원본과 동일하게 동작해야 한다:

| 시나리오 | 기대 |
|---|---|
| 정상 | payload 반환 + 커밋 |
| `summaries_session_id_key` 중복 | **`null` 반환**(예외 아님), 롤백 |
| 리스 소유권 상실 | `LeaseOwnershipError` 상당 예외 |

제약 판정은 제약명 문자열에 의존한다 — `PSQLException.getServerErrorMessage().getConstraint()` (`/SPEC.md` §6 #10).

**두 구현자가 서로 다른 접근(선언적 `@Transactional` vs `TransactionTemplate` vs 2층 분리)을 낼 것으로 예상되며, 그 대조가 이 단계의 목적이다.** 결론을 findings에 적고 M2~M3의 트랜잭션 관리 스타일로 확정한다.

### F. 운영 인스턴스 스펙 조회

dev는 t2.micro 1GB로 확인됐다(`docs/DEPLOY-DEV.md:76`). **운영 be 인스턴스 스펙은 문서에 없다.** SSM 또는 AWS CLI로 조회해 findings에 기록한다 — M5의 JVM 힙 튜닝과 인스턴스 업그레이드 판단 근거다.

## 하지 말 것

1. **엔티티 20개를 다 만들지 않는다.** D의 검증에 필요한 1~2개만.
2. **엔드포인트를 이식하지 않는다.** `/health` 하나뿐이다.
3. **기존 `apps/api`를 수정하지 않는다.**
4. **DB 스키마를 바꾸지 않는다.** 로컬 검증용 스키마도 alembic이 만든 것을 그대로 쓴다.
5. **Gemini 프롬프트를 옮기지 않는다.** SDK 능력 확인이 목적이지 파이프라인 이식이 아니다.
6. 스코프 밖 리팩터링 일체.

## 완료 기준 체크리스트

### 빌드·기동
- [ ] `./gradlew build` 성공 (wrapper 포함, 로컬 Gradle CLI 불필요)
- [ ] `./gradlew bootRun`으로 기동, `GET /health`가 위 B의 JSON 형상 반환
- [ ] `./gradlew bootJar` → `java -jar`로 동일 동작
- [ ] springdoc `/v3/api-docs`에서 `HealthResponse`가 `additionalProperties: false` + `status` const로 나온다
- [ ] Jackson이 `Instant`를 `...Z` + 마이크로초 6자리로 낸다 (단위 테스트)

### Gemini (C)
- [ ] Files API 업로드 성공
- [ ] `PROCESSING` → `ACTIVE` 폴링 성공, 타임아웃 경로 존재
- [ ] `responseSchema` 구조화 출력으로 스키마 준수 JSON 파싱 성공
- [ ] **결론 기록**: SDK 채택 여부. 미채택 시 REST 직접 호출 프로토타입이 위 3건을 통과

### Flyway (D)
- [ ] 기존 alembic 스키마에 baseline 적용 성공, **스키마 변경 0**
- [ ] `ddl-auto: validate`가 매핑한 1~2개 엔티티에 대해 통과
- [ ] 부분 인덱스·CHECK 제약이 validate를 깨지 않음을 확인

### 트랜잭션 프로토타입 (E)
- [ ] 정상 시나리오: payload 반환 + 커밋 (Testcontainers 통합 테스트)
- [ ] 중복 제약 위반: **`null` 반환**, 예외 전파 없음
- [ ] 리스 소유권 상실: 전용 예외
- [ ] 제약명 문자열로 중복을 판정한다 (`getConstraint()`)
- [ ] **결론 기록**: 채택한 트랜잭션 관리 스타일과 그 이유

### 기록
- [ ] `spec/M0-findings.md` 작성 — C·D·E·F의 결론과 근거
- [ ] findings에 따라 조정이 필요한 M1~M6 SPEC 항목을 목록으로 제시

## 검증 방법

```bash
cd apps/api-java
./gradlew build
./gradlew test                      # Testcontainers 필요 → Docker 기동 상태여야 함
./gradlew bootRun &
curl -s localhost:8080/health | python3 -m json.tool
curl -s localhost:8080/v3/api-docs | python3 -m json.tool | head -60
```

기존 백엔드와 나란히 띄워 `/health` 응답을 비교한다. 포트가 겹치지 않게 Java는 8080, 기존 FastAPI는 8000을 쓴다.

## 미결 사항

- Gemini 실호출에 쓸 샘플 영상 — `apps/api` 테스트 픽스처에 적당한 것이 없으면 짧은 파일을 새로 만든다(저장소에 커밋하지 않는다)
- Docker 기동 필요 (Testcontainers) — M0의 D·E 검증 시점에 필요하다
