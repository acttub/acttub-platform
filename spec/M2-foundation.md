# M2 — 기반 계층

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M2 사이클에만 적용된다.**

## 목적

도메인 이관(M3)이 올라탈 바닥을 만든다. 엔드포인트는 거의 늘지 않지만, **여기서 정한 규칙이 이후 50개 엔드포인트 전부에 복제되므로 가장 비싼 실수가 나올 수 있는 사이클**이다.

## 산출물

### A. Flyway — `V1__baseline.sql` + baseline 기록

M0의 D에서 검증한 방식을 확정한다 (`/SPEC.md` §5-5).

- **`V1__baseline.sql`이 현 스키마 전체를 동결한다** — 20 테이블 + 17 enum 타입 + 인덱스 + 제약 + 시드 데이터. **빈 DB의 유일한 스키마 생성 수단**이 되므로 M6에서 alembic을 지운 뒤에도 성립해야 한다
- **기존 DB(dev·운영)에는 같은 버전으로 baseline 기록만.** DDL 미실행, 스키마 변경 0
- `ddl-auto: validate`로 전 엔티티를 검증한다
- 부분 인덱스 3개(`models.py:802`, `832`, `839`)와 CHECK 제약(`765`)은 Flyway가 소유하고 Hibernate는 관여하지 않는다
- 스키마 비교 시 **`flyway_schema_history`·`alembic_version` 제외**

### B. JPA 엔티티 20개

`apps/api/acting-api/src/acting_api/db/models.py`(864줄)를 옮긴다.

```
users · user_identities · refresh_tokens · consent_documents · user_consents
upload_intents · practice_sessions · summaries · anomalies
coach_sessions · coach_turns · reports · external_operations
community_categories · community_posts · community_comments
community_anonymous_aliases · community_post_likes · community_reports · community_blocks
```

**규칙** (`/SPEC.md` §5-1, §5-3):
- 관계 매핑(`@ManyToOne` 등)을 만들지 않는다. FK는 UUID 컬럼으로 둔다
- **UUID PK 18개 중 17개가 앱 생성** → `Persistable<UUID>` 또는 `em.persist()`. **17개 전부 INSERT 전 SELECT가 없음을 검증**한다
- `CoachSession.id`가 그 예외 — `server_default`가 없고 agent 모듈의 문자열 파싱에서 온다(`store.py:1068`)
- `CommunityReport.target_id`는 의도적으로 FK 없음(`models.py:717`)
- JSONB 4개는 SQL NULL과 JSON null을 구분
- BIGSERIAL 2개(`Anomaly.id`, `CoachTurn.id`)는 `IDENTITY`
- `CHAR(64)` 2개(`refresh_tokens.token_hash`, `external_operations.request_fingerprint`)는 `columnDefinition` 명시 + 64자 hex 검증(`store.py:1988-1997`)
- **`server_default` vs `default` 판정을 컬럼별로 한다.** `focus_timestamp`(`452`)·`comparison`(`483`)의 `''`는 null로 두면 NOT NULL 위반

### C. enum AttributeConverter 17개

DB 타입명과 Java 타입을 1:1로 맞춘다.

```
user_status_t · identity_provider_t · consent_type_t · consent_action_t
upload_status_t · practice_status_t · intent_impact_t · severity_t
session_status_t · close_reason_t · turn_role_t
operation_kind_t · operation_status_t
content_status_t · report_target_type_t · report_reason_t · report_status_t
```

**`@Enumerated`를 쓰지 않는다** — varchar 바인딩이라 PG가 `operator does not exist`로 거부한다.

**`@JdbcTypeCode(SqlTypes.NAMED_ENUM)`과 `AttributeConverter`를 같이 걸지 않는다** — EntityManagerFactory 생성이 `Cannot read the array length because "values" is null`로 죽는다(M0 실측). **커스텀 `JdbcType`**(`setObject(..., Types.OTHER)`)으로 바인딩하고 값 매핑은 컨버터가 한다. M0의 `PgEnum`/`PgEnumJdbcType`/`PgEnumConverter`를 그대로 확장한다.

**`IntentImpact`는 값이 한글**이다 (`models.py:48-52`): `REVERSAL="반전"`, `WEAKENING="약화"`, `LOCAL="국소"`. Java enum 상수명을 그대로 쓰면 enum 타입 위반으로 즉시 실패한다.

나머지 16종도 전부 소문자 값이다.

**부팅 시 `pg_enum`과 Java enum을 대조하는 검증을 넣는다.** `0002`/`0003` 마이그레이션이 실제로 enum 값을 추가·개명한 이력이 있어 드리프트가 현실적 위험이다.

### D. JWT — 회전 refresh

`apps/api/acting-api/src/acting_api/auth/jwt.py`(177줄)를 옮긴다. 자작 구현이지만 표준 HS256과 호환된다.

| 항목 | 값 |
|---|---|
| 헤더 | `{"alg":"HS256","typ":"JWT"}` **정확히** (여분 필드 금지 — `kid` 자동 추가 주의) |
| 클레임 | `iss="acting-api"`, `aud="acting-app"`, `sub=<user UUID>`, `jti=<uuid4>`, `token_type="access"\|"refresh"`, `iat`, `exp` (전부 int epoch초) |
| 인코딩 | 공백 없음, base64url **패딩 제거**. **payload 키 정렬은 계약이 아니다** — Python 디코더는 `json.loads`라 순서에 무관하다(`jwt.py:142`) |
| 검증 | required 클레임 7개, iss/aud 일치, `token_type` 일치, `iat`/`exp`가 int 타입, `iat > now` 또는 **`exp <= now`(배타적)** 면 거부 |
| TTL | access 30분, refresh 14일 |

**회전 규칙**: 소진된 refresh 토큰을 재사용하면 **해당 유저의 전 세션을 무효화**한다(`store.py:300-350`). 의도된 동작이며 `/SPEC.md` §6 #6이다.

평문 JWT를 DB에 저장하지 않는다 — `token_hash`는 SHA-256 64자 hex.

**양방향 상호운용이 롤백 안전성을 결정한다.** M5에서 롤백하면 사용자는 **Java가 발급한 access·refresh 토큰을 들고 FastAPI로 돌아온다**(`auth/router.py:224-229`). Python이 그 헤더·클레임·DB hash를 받아들이지 못하면 "초 단위 복구" 직후 전 사용자가 로그아웃된다. 따라서 **Python→Java와 Java→Python을 둘 다 검증**한다.

### D-2. `DATABASE_URL` 변환

`/SPEC.md` §5-6. `postgresql://user:pass@host:5432/db`를 JDBC URL·username·password로 분해하는 설정 클래스를 만든다. **환경변수 이름은 유지**하고, 실제 배포 형식 URL로 부팅하는 테스트를 둔다.

### D-3. unknown key 정책

`/SPEC.md` §6-3. **전역 `FAIL_ON_UNKNOWN_PROPERTIES=true`를 켜지 않는다.** M2 범위에서는 `LoginRequest`·`LogoutRequest`·`RefreshRequest`·`ConsentRequest`가 unknown key를 **허용**해야 한다. DTO별로 정책을 지정하고 각각 회귀 테스트를 둔다.

### E. 인증 provider 3종

- **Google** (`auth/google.py`) — `google-auth` 대신 Spring Security `JwtDecoder`(JWKS 캐시)
- **Apple** (`auth/apple.py`) — **client_secret 서명·token exchange는 존재하지 않는다.** 실제 계약은 이것뿐이다:
  - issuer `https://appleid.apple.com`, JWKS `https://appleid.apple.com/auth/keys`, **RS256**
  - **audience는 콤마 구분 복수 허용** — `APPLE_OAUTH_CLIENT_ID`를 쪼개 그중 하나와 일치하면 통과 (`apple.py:32-35`)
  - `exp` 검증, `sub`가 비어 있으면 `InvalidIdentityToken`
  - **`email_verified`는 bool `true` 또는 문자열 `"true"`(대소문자 무시) 둘 다 받는다** (`apple.py:63-66`)
  - audience 미설정 시 JWKS 클라이언트를 만들지 않고 `ProviderConfigurationError`
- **development** (`auth/development.py`) — `DEVELOPMENT_AUTH_PROVIDER=1`일 때만 등록. **기본값이 '열림'이 되지 않게** 한다(`app.py:128-129`)

`ProviderRegistry`(`auth/providers.py`)가 `unsupported_provider` 400을 낸다.

### F. 레이트리밋

`ratelimit.py` — **사용자당 60회/분, 인메모리 고정 윈도우**. `clock` 주입 가능해야 테스트가 된다(`app.py:99`, `121`).

초과 시 429 `rate limit exceeded`(공백 포함 문장).

### G. consent 게이트

`auth/dependencies.py:84-93`. 필수 약관 미동의 시 403 `consent_required`.

의존성 4종의 조합을 그대로 재현한다(`app.py:131-135`):

| 이름 | 성격 |
|---|---|
| `current_user` | 토큰 필수 |
| `optional_user` | 토큰 없으면 익명 통과 (커뮤니티 읽기) |
| `rate_limited_user` | `current_user` + 레이트리밋 |
| `consented_user` | `rate_limited_user` + 동의 게이트 |

**프로필(`/v2/me`)은 동의 게이트를 걸지 않는다** — 동의 화면에서 이름을 함께 받기 때문(`app.py:289`).

### H. 오류 처리 `@ControllerAdvice`

- 전 오류를 `{"detail": <str>}`로 낸다. **Spring 기본 `ProblemDetail`을 반드시 오버라이드**
- 422 validation만 `detail`이 **배열** — FastAPI `HTTPValidationError` 형상과 일치시킨다
- `NoCredentialsError` 계열 → 503 `storage_not_configured` (`app.py:220-234` 대응)
- **404는 "없음"과 "남의 것"을 구분하지 않는다**

## 이 사이클에서 확정할 결정 2개

`/SPEC.md` §10의 M2 몫이다. findings에 근거와 함께 기록한다.

### 결정 1 — 시계 소스

현재 세 갈래로 혼재한다:
- `server_default=now()` (DB 시계) — `created_at` 등
- 코드가 `datetime.now(timezone.utc)` 생성 후 전달 — `store.py:301`, `326`, `367` 외 20여 곳
- `func.now()` 대입 — `store.py:203`, `community_store.py:375`, `403`, `644`, `664`

**리스 만료 비교(`store.py:1423`, `1462`, `1777`)가 앱 시계와 DB 저장값을 비교**하므로 클럭 스큐가 버그가 된다. 한쪽으로 명시하고 그 이유를 적는다.

주의: `updated_at`에 `func.now()`를 쓰고 `created_at`은 `server_default`인 테이블에서, 앱 시계로 바꾸면 한 행 안에서 `updated_at < created_at`이 나올 수 있다.

### 결정 2 — `SKIP LOCKED`

현재 0건이다. `claim_next_external_operation`(`store.py:1466-1487`)은 후보 1건을 서브쿼리로 고르고 UPDATE의 WHERE에 조건을 다시 적용한다. 워커 2개가 경합하면 하나가 블로킹 대기 → 락 해제 후 조건 재평가 실패 → 0행 → `None` → 폴링 재시도.

**기본 방침은 원본 동작 재현이다**(`/SPEC.md` §7-4). 개선하려면 워커 폴링 로직(`analysis_worker.py:96-97`)과 동시성 테스트(`test_db_store.py:751`)를 함께 검토하고 근거를 남긴다.

## 하지 말 것

1. **도메인 엔드포인트를 이식하지 않는다.** M3의 몫이다. M2는 `/health` + 인증 경로(`/v2/auth/*`)까지만.
2. **DB 스키마를 바꾸지 않는다.** 마이그레이션 신규 작성 금지.
3. **관계 매핑을 만들지 않는다.**
4. **`@Enumerated`를 쓰지 않는다.**
5. 기존 `apps/api` 수정 금지.
6. 스코프 밖 리팩터링 일체.

## 완료 기준 체크리스트

### Flyway·엔티티
- [ ] **빈 DB에 `V1__baseline.sql` 실행 → alembic 결과와 `pg_dump` diff 0** (메타 테이블 제외)
- [ ] 기존 DB에 baseline 기록 → **DDL 미실행, 스키마 변경 0**
- [ ] `ddl-auto: validate`가 엔티티 20개 전부에 대해 통과
- [ ] 부분 인덱스 3개·CHECK 제약이 유지된다
- [ ] `save()`가 **앱 생성 UUID PK 17개 전부**에서 SELECT를 유발하지 않는다 (SQL 로그 검증)

### enum
- [ ] 컨버터 17개, `@Enumerated` 사용 0건 (정적 검사)
- [ ] `IntentImpact` 한글 값 왕복 성공
- [ ] 나머지 16종 소문자 값 왕복 성공
- [ ] 부팅 시 `pg_enum` 대조 검증이 동작하고, 값이 어긋나면 기동 실패

### JWT·인증
- [ ] **Python 발급 토큰을 Java가 검증**한다
- [ ] **Java 발급 access·refresh 토큰을 Python이 검증**한다 — 롤백 안전성
- [ ] **Java 발급 refresh로 Python에서 실제 회전**이 되고, 재사용 시 전 세션이 폐기된다
- [ ] Java 발급 토큰의 헤더가 `{"alg":"HS256","typ":"JWT"}` 정확히 — **`kid` 없음**
- [ ] base64url 패딩이 없다 (payload 키 정렬은 검증하지 않는다)
- [ ] `exp <= now`가 배타적으로 만료된다 (경계 테스트)
- [ ] 회전: 소진 토큰 재사용 → **전 세션 무효화** (Testcontainers 동시성 테스트)
- [ ] 평문 JWT가 DB에 없다. `token_hash`가 SHA-256 64자 hex
- [ ] provider 3종 등록. `DEVELOPMENT_AUTH_PROVIDER` 없으면 development 미등록
- [ ] 미지원 provider → 400 `unsupported_provider`
- [ ] Apple: 복수 audience 중 하나 일치 통과, `email_verified`가 bool·문자열 둘 다 처리

### 연결·직렬화
- [ ] 실제 배포 형식 `DATABASE_URL`로 부팅 성공
- [ ] `LoginRequest`·`LogoutRequest`·`RefreshRequest`·`ConsentRequest`가 **unknown key를 허용**한다 (회귀 테스트)
- [ ] 전역 `FAIL_ON_UNKNOWN_PROPERTIES`가 켜져 있지 않다 (정적 검사)

### 게이트·오류
- [ ] 레이트리밋 60회/분, 초과 시 429 `rate limit exceeded`
- [ ] 미동의 시 403 `consent_required`. `/v2/me`는 게이트 없음
- [ ] 의존성 4종 조합이 원본과 동일
- [ ] 전 오류가 `{"detail": <str>}`. 422만 배열
- [ ] 404가 "없음"과 "남의 것"을 구분하지 않는다

### 계약
- [ ] **M1 하네스로 `/v2/auth/*` 비교 통과**
- [ ] `openapi.json` diff가 인증 경로에서 0 (datetime 통일 제외)

### 결정 기록
- [ ] 시계 소스 결정과 근거가 `spec/M2-findings.md`에 있다
- [ ] `SKIP LOCKED` 결정과 근거가 있다

## 검증 방법

```bash
cd apps/api-java
./gradlew test                     # Testcontainers — Docker 필요
./gradlew bootRun &

# Python 백엔드도 띄우고 하네스로 비교
python -m contract_harness --baseline fastapi --target java --only /v2/auth,/health
```

스키마 무변경 확인:
```bash
pg_dump --schema-only <db> > before.sql
# Flyway baseline 적용
pg_dump --schema-only <db> > after.sql
diff before.sql after.sql          # 비어 있어야 한다
```
