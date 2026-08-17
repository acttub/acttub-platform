# M2 — 기반 계층

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M2 사이클에만 적용된다.**

> 🔁 **도구 이름은 M2 시점의 것이다.** `regen-baseline.sh`·`canonical-dump.sh` 는 지금 없다 —
> alembic 이 정본이던 시절의 것이라 `SOMA-403` 3단계에서 은퇴했고, fixture 재생성은
> `scripts/regen-fingerprint.sh` 가 한다. 아래 명령을 그대로 따라 하지 않는다.

## 목적

도메인 이관(M3)이 올라탈 바닥을 만든다. 엔드포인트는 거의 늘지 않지만, **여기서 정한 규칙이 이후 50개 엔드포인트 전부에 복제되므로 가장 비싼 실수가 나올 수 있는 사이클**이다.

그래서 이 문서의 완료 기준은 "구현했다"가 아니라 **"틀렸으면 빨간불이 뜬다"** 를 기준으로 쓴다. 헐거운 기준은 틀린 구현을 초록으로 통과시키고, 그 오류는 M3에서 50배로 복제된다.

## 산출물

### A. Flyway — `V1__baseline.sql` + baseline 기록

M0의 D에서 검증한 방식을 확정한다 (`/SPEC.md` §5-5).

- **`V1__baseline.sql`이 현 스키마 전체를 동결한다** — 24 테이블 + 17 enum 타입 + 인덱스 + 제약 + 시드 데이터. **빈 DB의 유일한 스키마 생성 수단**이 되므로 M6에서 alembic을 지운 뒤에도 성립해야 한다
- **기존 DB(dev·운영)에는 같은 버전으로 baseline 기록만.** DDL 미실행, 스키마 변경 0
- `ddl-auto: validate`로 전 엔티티를 검증한다
- 부분 인덱스 3개와 CHECK 제약 4개(`/SPEC.md` §5-3-6 — 개수는 fingerprint 에서 센다)는 Flyway가 소유하고 Hibernate는 관여하지 않는다
- 스키마 비교 시 **`flyway_schema_history`·`alembic_version` 제외**

**"diff 0"이 증명하는 것은 구조적 동등성뿐이다.** `apps/api-java/scripts/regen-baseline.sh`는 `--schema-only --no-owner --no-privileges`로 덤프하고, `schema-fingerprint.sql`은 enum·테이블·컬럼·제약·인덱스·시퀀스 **정의**만 조회한다. enum 값 순서(`enumsortorder`)와 컬럼 default 식(`column_default`)은 이미 비교하므로 그 둘은 현재 기준으로 충분하다. **다음은 보지 못한다** — 시퀀스의 `last_value`/`is_called`, owner·GRANT, database 수준 collation/ctype/encoding, object comment, explicit `COLLATE`. M2는 이것을 재해복구 동등성으로 주장하지 않는다. 전체 복구 동등성 관문은 M6가 진다(`spec/M6-cleanup.md`에 연결한다).

**시드는 정본에서 생성한다.** 현재 `regen-baseline.sh`는 시드 블록을 **기존 `V1__baseline.sql`에서 복사**하고, `FlywayBaselineTest.freshDatabaseHasTheObjectsThatHibernateCannotCreate`는 `community_categories`가 3건인지만 센다. 그래서 `slug`·`name`·`description`·`sort_order` 중 무엇이 바뀌어도 둘 다 통과한다. 정본은 `alembic/versions/0005_user_nickname_and_community.py:_SEED_CATEGORIES`다 — 시드 SQL을 alembic 결과 DB에서 실제 행 값으로 추출하도록 바꾸고, 검증은 건수가 아니라 **정렬된 전체 행 값의 집합 동등성**으로 한다.

### B. JPA 엔티티 24개

`apps/api/acting-api/src/acting_api/db/models.py`를 옮긴다.

```
users · user_identities · refresh_tokens · consent_documents · user_consents
upload_intents · practice_sessions · transcripts · summaries · anomalies
coach_sessions · coach_turns · coaching_handoffs · handoff_confirmations
practice_reports · reports · external_operations
community_categories · community_posts · community_comments
community_anonymous_aliases · community_post_likes · community_reports · community_blocks
```

⚠ **초판은 20개였다.** `transcripts`·`coaching_handoffs`·`handoff_confirmations`·`practice_reports` 4개가 빠져 있었다(앞의 셋은 `SOMA-302`/`0007` 계열, `practice_reports`는 리포트 계층 이전분). **`ddl-auto: validate`는 매핑하지 않은 테이블을 문제 삼지 않으므로, 20개만 만들어도 초록이 뜬다.** 개수를 세는 완료 기준이 필요한 이유가 이것이다.

**규칙** (`/SPEC.md` §5-1, §5-3):
- 관계 매핑(`@ManyToOne` 등)을 만들지 않는다. FK는 UUID 컬럼으로 둔다
- **UUID PK 22개 중 20개가 앱 생성** → `Persistable<UUID>` 또는 `em.persist()`. **20개 전부 INSERT 전 SELECT가 없음을 검증**한다. 나머지 둘은 예외다:
  - `CoachSession.id` — `server_default`가 없고 agent 모듈의 문자열 파싱에서 온다(`db/store.py:PostgresStore._add_coach_session`)
  - `HandoffConfirmation.coaching_handoff_id` — FK 겸 PK다(`db/models.py:HandoffConfirmation`)
- `CommunityReport.target_id`는 의도적으로 FK 없음(`db/models.py:CommunityReport`)
- **JSONB 8개**(`/SPEC.md` §5-3-4)는 SQL NULL과 JSON null을 구분 — 아래 **결정 3** 참조
- BIGSERIAL 2개(`Anomaly.id`, `CoachTurn.id`)는 `IDENTITY`
- `CHAR(64)` 2개(`refresh_tokens.token_hash`, `external_operations.request_fingerprint`)는 `columnDefinition` 명시 + 64자 hex 검증(`db/store.py:PostgresStore._validate_sha256`)
- **`server_default` vs `default` 판정을 컬럼별로 한다.** 빈 문자열 기본값(`default=""` + `server_default=''`)은 두 곳뿐이다 — `db/models.py:CoachSession`의 `conversation_summary`, `db/models.py:Report`의 `comparison`. null로 두면 NOT NULL 위반이다 (컬럼은 클래스 속성이라 `check-refs.py`가 심볼로 해석하지 못한다. 규약대로 클래스까지만 참조한다)

⚠ 초판이 이 자리에 적었던 `coach_turns.focus_timestamp`는 **존재하지 않는 컬럼**이다. `alembic/versions/0007_prompt_handoffs.py:upgrade`가 삭제했고, 현재 `db/models.py:CoachTurn`의 컬럼은 `id`·`session_id`·`turn_index`·`role`·`text`·`created_at` 여섯 개뿐이다. 매핑하면 기동이 실패하거나 금지된 마이그레이션을 유도한다.

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

**`IntentImpact`는 값이 한글**이다 (`db/models.py:IntentImpact`): `REVERSAL="반전"`, `WEAKENING="약화"`, `LOCAL="국소"`. Java enum 상수명을 그대로 쓰면 enum 타입 위반으로 즉시 실패한다.

나머지 16종도 전부 소문자 값이다.

**부팅 시 `pg_enum`과 Java enum을 대조하는 검증을 넣는다.** `0002`/`0003` 마이그레이션이 실제로 enum 값을 추가·개명한 이력이 있어 드리프트가 현실적 위험이다.

### D. JWT — 회전 refresh

`apps/api/acting-api/src/acting_api/auth/jwt.py`를 옮긴다. 자작 구현이지만 표준 HS256과 호환된다.

| 항목 | 값 |
|---|---|
| 헤더 | `{"alg":"HS256","typ":"JWT"}` **정확히** (여분 필드 금지 — `kid` 자동 추가 주의) |
| 클레임 | `iss="acting-api"`, `aud="acting-app"`, `sub=<user UUID>`, `jti=<uuid4>`, `token_type="access"\|"refresh"`, `iat`, `exp` (전부 int epoch초) |
| 인코딩 | 공백 없음, base64url **패딩 제거**. **payload 키 정렬은 계약이 아니다** — Python 디코더는 `json.loads`라 순서에 무관하다(`auth/jwt.py:JwtService._decode`) |
| 검증 | required 클레임 7개, iss/aud 일치, `token_type` 일치, `iat`/`exp`가 int 타입, `iat > now` 또는 **`exp <= now`(배타적)** 면 거부. **clock skew 허용 0** |
| TTL | access 30분, refresh 14일 |
| secret | 문자열을 **그대로 UTF-8 bytes**로 쓴다(`auth/jwt.py:JwtService.__init__`). base64 디코딩하지 않는다 |
| hash | `security.py:hash_token` — JWT **문자열의 UTF-8 bytes**를 SHA-256 `hexdigest()` |

**회전 규칙**: 소진된 refresh 토큰을 재사용하면 **해당 유저의 전 세션을 무효화**한다. 구현은 `db/store.py:PostgresStore.rotate_refresh_token`이며 `SELECT ... FOR UPDATE` 안에서 판정한다. 의도된 동작이며 `/SPEC.md` §6 #6이다.

⚠ 초판은 이 규칙을 `issue_refresh_token`이 한다고 적었다. **그 함수는 발급만 한다** — 재사용 감지와 일괄 폐기는 `rotate_refresh_token`에 있다. 심볼이 둘 다 실재하므로 `check-refs.py`는 이 오인용을 잡지 못했다(`/SPEC.md` §12의 구멍).

평문 JWT를 DB에 저장하지 않는다 — `token_hash`는 SHA-256 64자 hex.

**양방향 상호운용이 롤백 안전성을 결정한다.** M5에서 롤백하면 사용자는 **Java가 발급한 access·refresh 토큰을 들고 FastAPI로 돌아온다**(`auth/router.py:build_router.refresh`). Python이 그 헤더·클레임·DB hash를 받아들이지 못하면 "초 단위 복구" 직후 전 사용자가 로그아웃된다.

**따라서 decoder 단위 테스트로는 부족하다.** 완료 기준은 **같은 `JWT_SECRET`과 같은 DB를 공유한 실행 중 FastAPI**에 대고 판정한다 — Java access token으로 보호 API를 실제 호출하고, Java refresh token으로 `/v2/auth/refresh`를 실제 호출한다. secret은 ASCII가 아닌 raw UTF-8 값을 최소 한 벡터 포함한다(평범한 ASCII만 쓰면 bytes 처리 차이가 드러나지 않는다).

### D-2. `DATABASE_URL` 변환

`/SPEC.md` §5-6. `postgresql://user:pass@host:5432/db`를 JDBC URL·username·password로 분해하는 설정 클래스를 만든다. **환경변수 이름은 유지**하고, 실제 배포 형식 URL로 부팅하는 테스트를 둔다.

### D-3. unknown key 정책 — 전역 `true`를 유지한다

`/SPEC.md` §6-3. **전역 `fail-on-unknown-properties: true`를 켠 채로 두고, 허용해야 하는 DTO에만 `@JsonIgnoreProperties(ignoreUnknown = true)`를 붙인다.**

⚠ **초판은 정반대로 적혀 있었다**("전역을 켜지 않는다" + 완료 기준의 정적 검사). 그 방향은 **M0에서 실제로 시도해 실패한 B안**이다 — `spec/M0-findings.md`가 기록한다: `@JsonIgnoreProperties(ignoreUnknown = false)`는 "거부하라"가 아니라 "전역 설정을 따르라"는 뜻이라 예외가 나지 않고, Jackson에는 "전역 false + DTO별 true 강제"를 표현할 수단이 없다. M0가 이미 `application.yml`에 `spring.jackson.deserialization.fail-on-unknown-properties: true`를 넣어 두었다.

M2 범위에서 만드는 요청 DTO 중 허용 대상은 `LoginRequest`·`LogoutRequest`·`RefreshRequest` 3개다(`auth/router.py`의 각 모델이 기본 `BaseModel`이라 unknown key를 허용한다). `ConsentRequest`·`UploadIntentRequest`도 허용 집합이지만 해당 엔드포인트는 M3 몫이므로 그때 같은 규칙을 적용한다.

**개수를 SPEC에 박지 않는다** — 허용 집합은 실행 시점 `openapi.json`에서 생성한다(초판 작성 이후 7→5로 이미 한 번 바뀌었다).

### E. 인증 provider 3종

- **Google** (`auth/google.py`) — `google-auth` 대신 Spring Security `JwtDecoder`(JWKS 캐시). 원본 `auth/google.py:GoogleProviderVerifier.verify`는 configured audience를 검증에 넘기고, `sub`를 필수로 보며, 빈 email은 `None`으로 정규화하고, `email_verified`의 bool `true`와 문자열 `"true"`를 **둘 다** 받는다
- **Apple** (`auth/apple.py`) — **client_secret 서명·token exchange는 존재하지 않는다.** 실제 계약은 이것뿐이다:
  - issuer `https://appleid.apple.com`, JWKS `https://appleid.apple.com/auth/keys`, **RS256**
  - **audience는 콤마 구분 복수 허용** — `APPLE_OAUTH_CLIENT_ID`를 쪼개 그중 하나와 일치하면 통과 (`auth/apple.py:AppleProviderVerifier.__init__`)
  - `exp` 검증, `sub`가 비어 있으면 `InvalidIdentityToken`
  - **`email_verified`는 bool `true` 또는 문자열 `"true"`(대소문자 무시) 둘 다 받는다** (`auth/apple.py:AppleProviderVerifier.verify`)
  - audience 미설정 시 JWKS 클라이언트를 만들지 않고 `ProviderConfigurationError`
- **development** (`auth/development.py`) — `DEVELOPMENT_AUTH_PROVIDER`가 켜졌을 때만 등록. **기본값이 '열림'이 되지 않게** 한다(`app.py:create_app`). 원본이 인정하는 켜짐 표기를 그대로 따른다(`"1"`과 대소문자 무시 `"true"`)

`ProviderRegistry`(`auth/providers.py`)가 `unsupported_provider` 400을 낸다.

**두 provider 모두 테스트 벡터로 판정한다** — valid / wrong issuer / wrong audience / expired / missing sub / email 정규화 / `email_verified` bool·문자열. 벡터가 없으면 issuer나 expiry 검증을 통째로 빠뜨려도 체크리스트가 초록이 된다. `config.py:DEFAULT_GOOGLE_OAUTH_CLIENT_ID`·`:DEFAULT_APPLE_OAUTH_CLIENT_ID`가 env 부재 시에도 기본 audience를 주는 것까지 재현한다.

### F. 레이트리밋 — key-space 두 개다

`ratelimit.py` — **고정 윈도우, 분당 60회, 인메모리**. `clock` 주입 가능해야 테스트가 된다(`app.py:create_app`).

**두 개의 key-space가 있다. 초판은 사용자 것만 적었다.**

| key | 적용 지점 | 특징 |
|---|---|---|
| `auth-ip:<client_host>` | `auth/router.py:build_router.enforce_ip_rate_limit` — login·refresh | **provider·JWT 검증보다 먼저** 실행된다 |
| 사용자 키 | `auth/router.py:build_router.enforce_rate_limit`(login·refresh·logout), `auth/dependencies.py:build_rate_limited_user_dependency`(그 외 보호 경로) | 사용자를 특정한 뒤 |

IP limiter를 빠뜨리면 **실패하는 login·refresh 시도가 무제한으로 통과한다** — 사용자를 알아내기 전이라 사용자 키로는 막히지 않는다.

초과 시 429 `rate limit exceeded`(공백 포함 문장).

**카운터는 원자적이어야 한다.** Java는 요청을 병렬로 처리하므로, 순차 61회 테스트만으로는 61개가 새는 구현을 잡지 못한다. 같은 key로 동시 요청을 던져 **정확히 60개만** 허용되는지 검증한다.

`ratelimit.py:RateLimiter`가 monotonic 시계를 쓰는 것은 의도다 — 아래 **결정 1** 참조.

### G. consent 게이트 + 문서 publish

**게이트**: `auth/dependencies.py:build_consent_gate_dependency`. 필수 약관 미동의 시 403 `consent_required`.

의존성 4종의 조합을 그대로 재현한다(`app.py:create_app`):

| 이름 | 성격 |
|---|---|
| `current_user` | 토큰 필수 |
| `optional_user` | 토큰 없으면 익명 통과 (커뮤니티 읽기) |
| `rate_limited_user` | `current_user` + 레이트리밋 |
| `consented_user` | `rate_limited_user` + 동의 게이트 |

**프로필(`/v2/me`)은 동의 게이트를 걸지 않는다** — 동의 화면에서 이름을 함께 받기 때문(`app.py:create_app`). M2에는 그 엔드포인트가 없으므로 이 정책은 **의존성 조합 테스트로만** 검증하고, HTTP 수준 확인은 M3로 넘긴다.

**부팅 시 문서 publish도 M2 몫이다.** `app.py:create_app`의 lifespan이 `consents.py:seed_consent_documents`를 호출한다. 이것을 빠뜨리면 **빈 DB에서 필수 약관이 하나도 없어 모든 동의가 자동 통과**하고, M6 이후 새 약관 버전을 배포할 경로도 사라진다. `V1__baseline.sql`이 넣는 시드는 커뮤니티 카테고리뿐이라 여기서 메워지지 않는다.

원본의 best-effort 기동 시맨틱을 그대로 옮긴다 — manifest 전체를 먼저 검증하고, 같은 type/version의 내용 차이는 경고, unique 경합은 무시, 실패해도 **기동은 계속**한다.

### H. 오류 처리 `@ControllerAdvice`

- 전 오류를 `{"detail": <str>}`로 낸다. **Spring 기본 `ProblemDetail`을 반드시 오버라이드**
- 422 validation만 `detail`이 **배열** — FastAPI `HTTPValidationError` 형상과 일치시킨다. 배열이라는 사실만이 아니라 각 항목의 `loc`·`msg`·`type`까지 맞춘다
- `NoCredentialsError` 계열 → 503 `storage_not_configured` (`app.py:create_app.storage_credentials_error_handler` 대응)
- **404는 "없음"과 "남의 것"을 구분하지 않는다** — M2에는 소유권 있는 리소스 경로가 없으므로 이 정책의 HTTP 검증은 M3 몫이다

**판정은 golden 비교로 한다.** M2 범위(`/health`·`/v2/auth/*`)의 오류 목록을 인벤토리로 뽑고 status + **전체 JSON 바디**를 대조한다. validation은 missing field·wrong type·malformed JSON을 각각 두고, 404·405와 인증 필터 진입점에서 `ProblemDetail`이 새지 않는지도 별도 사례로 둔다.

## 이 사이클에서 확정할 결정 3개

`/SPEC.md` §10의 M2 몫이다. `spec/M2-findings.md`에 근거와 함께 기록한다. **문장만 적는 것으로는 완료가 아니다** — 각 결정에는 아래 명시한 판별 테스트가 따라붙는다.

### 결정 1 — 시계 소스 (양자택일이 아니라 policy matrix)

현재 세 갈래로 혼재하는데, **셋은 용도가 다르므로 하나로 통일하는 것이 목표가 아니다.**

| 층 | 현재 | 비고 |
|---|---|---|
| DB 저장 timestamp | `server_default=now()` (`created_at` 등) + `func.now()` 대입(`db/store.py:PostgresStore.update_user_nickname`, `db/community_store.py:CommunityStore.update_post` 계열) | 트랜잭션 시계 |
| 앱 wall clock | `datetime.now(timezone.utc)` — `db/store.py:PostgresStore.issue_refresh_token` 외 20여 곳, JWT `iat`/`exp` | epoch 필요 |
| monotonic | `ratelimit.py:RateLimiter` | 경과 시간 측정. wall clock으로 바꾸면 NTP 조정에 취약해진다 |

**리스 만료 비교(`db/store.py:PostgresStore.claim_external_operation`·`.claim_next_external_operation`·`.sweep_max_attempts_operations`)가 앱 시계와 DB 저장값을 비교**하므로 클럭 스큐가 버그가 된다.

**결정할 것**: 세 층 각각의 시계 소스, 리스 만료 경계(`<` 인가 `<=` 인가), 테스트 시계 주입 범위. 그리고 **한 행 안의 불변식** — `updated_at`에 `func.now()`를 쓰고 `created_at`은 `server_default`인 테이블에서 앱 시계로 바꾸면 `updated_at < created_at`이 나올 수 있다. `updated_at >= created_at`을 강제하는 테스트를 남긴다.

### 결정 2 — `SKIP LOCKED`

현재 0건이다. `claim_next_external_operation`(`db/store.py:PostgresStore.claim_next_external_operation`)은 후보 1건을 `created_at, id` 순으로 고르고 UPDATE의 WHERE에 조건을 다시 적용한다. 워커 2개가 경합하면 하나가 블로킹 대기 → 락 해제 후 조건 재평가 실패 → 0행 → `None` → 폴링 재시도.

**기본 방침은 원본 동작 재현이다**(`/SPEC.md` §7-4).

**판별 테스트를 반드시 만든다.** 기존 테스트로는 두 방식을 구분할 수 없다 — `tests/test_db_store.py:test_external_operation_idempotency_lease_race_and_atomic_completion`은 **같은 ID**에 `claim_external_operation`을 두 번 걸고, `:test_background_claim_skips_failed_and_transient_release_requeues`는 `claim_next_external_operation`을 순차로 부를 뿐이다. pending 작업을 **2건** 만들고 첫 트랜잭션이 가장 오래된 행을 잠근 상태에서 두 번째 `claim_next`를 실행해야 갈린다 — 원본 유지면 대기 후 `None`, `SKIP LOCKED`면 두 번째 작업을 집는다. 도입한다면 **처리 순서가 바뀐다는 점을 명시적으로 승인**하고 근거를 남긴다.

### 결정 3 — JSONB 8개의 Java 표현 (신규)

`/SPEC.md` §5-3-4의 8개 컬럼이 대상이다: `summaries.observation`(NULL 허용)·`.raw`·`.observations_json`·`.uncertainties_json`, `coaching_handoffs.handoff_json`, `practice_reports.report_json`, `reports.biggest_problem`, `external_operations.response_payload`(NULL 허용).

형상이 서로 다르다 — `db/models.py:Summary`만 봐도 `list[dict]`·`list[str]`·nullable `dict`·non-null `dict`가 섞여 있다.

**`JsonNode` / 타입 컬렉션 / JSON 문자열 중 무엇을 canonical로 삼느냐가 Hibernate dirty checking, DTO 변환, null 처리, 네이티브 SQL 바인딩을 전부 가른다.** 엔티티 24개를 만든 뒤 M3에서 뒤집으면 repository·service·테스트를 다 다시 손대야 하므로 **여기서 확정한다.**

판별 테스트: 객체·배열·**SQL NULL**·**JSON `null`(`'null'::jsonb`)** 네 경우를 실제 Postgres에 왕복시켜 구분이 유지되는지 본다. 현재 코드는 SQL NULL을 의도한다(`db/store.py:PostgresStore.claim_external_operation` 계열).

## 하지 말 것

1. **도메인 엔드포인트를 이식하지 않는다.** M3의 몫이다. M2는 `/health` + 인증 경로(`/v2/auth/*`)까지만. `/v2/me`·`/v2/consents`도 여기 포함되지 않는다 — 그래서 그 경로에 걸린 정책(동의 게이트 면제, 소유권 404)은 M2에서 **의존성·단위 수준으로만** 검증하고 HTTP 검증은 M3로 넘긴다
2. **DB 스키마를 바꾸지 않는다.** 마이그레이션 신규 작성 금지.
3. **관계 매핑을 만들지 않는다.**
4. **`@Enumerated`를 쓰지 않는다.**
5. 기존 `apps/api` 수정 금지.
6. 스코프 밖 리팩터링 일체.

## 완료 기준 체크리스트

### Flyway·엔티티
- [ ] **빈 DB에 `V1__baseline.sql` 실행 → alembic 결과와 구조적 fingerprint diff 0** (`flyway_schema_history`·`alembic_version` 제외). **재해복구 동등성은 주장하지 않는다** — 시퀀스 상태·owner/GRANT·collation·comment는 M6 관문
- [ ] 시드가 `alembic/versions/0005_user_nickname_and_community.py:_SEED_CATEGORIES` 정본에서 생성되고, **정렬된 전체 행 값의 집합**이 일치한다 (건수 비교 금지)
- [ ] 기존 DB에 baseline 기록 → **DDL 미실행, 스키마 변경 0**
- [ ] `ddl-auto: validate`가 **엔티티 24개** 전부에 대해 통과하고, **매핑된 엔티티 수가 24인지 세는 검사**가 있다
- [ ] 부분 인덱스 3개·CHECK 제약이 유지된다
- [ ] `save()`가 **앱 생성 UUID PK 20개 전부**에서 SELECT를 유발하지 않는다 (SQL 로그 검증)
- [ ] `CoachSession.id`·`HandoffConfirmation.coaching_handoff_id` 두 예외가 각각의 경로로 동작한다

### enum
- [ ] 컨버터 17개, `@Enumerated` 사용 0건 (정적 검사)
- [ ] `IntentImpact` 한글 값 왕복 성공
- [ ] 나머지 16종 소문자 값 왕복 성공
- [ ] 부팅 시 `pg_enum` 대조 검증이 동작하고, 값이 어긋나면 기동 실패

### JSONB
- [ ] 8개 컬럼의 canonical Java 표현이 결정되고 전부 그것으로 매핑됐다
- [ ] 객체·배열·SQL NULL·JSON `null` 네 경우가 실제 Postgres 왕복에서 구분된다

### JWT·인증
- [ ] **실행 중 FastAPI에 Java access token으로 보호 API 호출 성공** (같은 `JWT_SECRET`·같은 DB)
- [ ] **실행 중 FastAPI의 `/v2/auth/refresh`를 Java refresh token으로 호출 성공** — 롤백 안전성
- [ ] **Python 발급 토큰을 Java가 검증**한다
- [ ] raw UTF-8(비 ASCII) secret 벡터가 양방향에서 통과한다. secret 부재·빈 값이면 **기동 실패**
- [ ] Java 발급 토큰의 헤더가 `{"alg":"HS256","typ":"JWT"}` 정확히 — **`kid` 없음**
- [ ] base64url 패딩이 없다 (payload 키 정렬은 검증하지 않는다)
- [ ] `exp <= now`가 배타적으로 만료된다. clock skew 허용 0 (경계 테스트)
- [ ] 회전: 소진 토큰 재사용 → **전 세션 무효화** (`rotate_refresh_token` 경로)
- [ ] **같은 refresh를 2스레드가 동시 제출 → 200 한 건·401 한 건, 그리고 해당 사용자 토큰 전량 revoke** (Testcontainers)
- [ ] 평문 JWT가 DB에 없다. `token_hash`가 JWT 문자열 UTF-8 bytes의 SHA-256 64자 hex
- [ ] provider 3종 등록. `DEVELOPMENT_AUTH_PROVIDER`가 `"1"`·`"true"`(대소문자 무시)에서 켜지고, 없으면 미등록
- [ ] 미지원 provider → 400 `unsupported_provider`
- [ ] Google·Apple 각각 테스트 벡터 7종 통과 (valid / wrong issuer / wrong audience / expired / missing sub / email 정규화 / `email_verified` bool·문자열)
- [ ] env 부재 시 기본 client ID가 적용되고, audience 미설정이면 `ProviderConfigurationError`

### 연결·직렬화
- [ ] 실제 배포 형식 `DATABASE_URL`로 부팅 성공
- [ ] **전역 `fail-on-unknown-properties`가 `true`다** (정적 검사)
- [ ] `LoginRequest`·`LogoutRequest`·`RefreshRequest`가 unknown key를 **허용**한다 (회귀 테스트)
- [ ] 허용 집합이 실행 시점 `openapi.json`에서 생성된 목록과 일치한다

### 게이트·오류
- [ ] 사용자 키 레이트리밋 60회/분, 초과 시 429 `rate limit exceeded`
- [ ] **IP 키(`auth-ip:<host>`) 레이트리밋이 login·refresh에서 provider·JWT 검증보다 먼저** 동작한다
- [ ] **같은 key 동시 요청에서 정확히 60개만 통과** (원자성)
- [ ] 미동의 시 403 `consent_required` (의존성 수준 검증)
- [ ] 의존성 4종 조합이 원본과 동일 (단위·통합 테스트)
- [ ] **빈 DB 기동 시 manifest의 consent 문서가 publish**되고, manifest 부재·오류·unique 경합에서도 **기동이 계속**된다
- [ ] M2 범위 오류 인벤토리 전체가 status + **전체 JSON 바디** golden 비교를 통과한다
- [ ] 422가 `loc`·`msg`·`type`까지 FastAPI와 일치한다 (missing field·wrong type·malformed JSON 각각)
- [ ] 404·405와 인증 필터 진입점에서 `ProblemDetail`이 새지 않는다

### 계약
- [ ] **M1 하네스 `health` 시나리오를 Java 타겟으로 통과** — 하네스가 Java를 상대로 판정할 수 있음을 처음 실증하는 지점이다
- [ ] `openapi.json` diff가 인증 경로에서 0 (datetime 통일 제외)

⚠ **auth 시나리오 비교는 M2에서 달성할 수 없다.** 초판은 "`/v2/auth/*` 비교 통과"를 완료 기준에 넣었지만, 하네스가 그것을 구조적으로 막는다 — `tools/contract-harness/contract_harness/backends.py:JavaBackend`가 **"M1 시점 Java는 `/health` 뿐이다 — 제어 표면 없이 붙기만 한다. 제어 표면 5개를 만족시키는 것은 M4의 일"** 이라고 규정한다. auth 시나리오는 Google·Apple provider를 스텁으로 바꿔야 성립하는데, FastAPI 쪽은 in-process 래퍼(`wrapper.py`)로 주입하는 반면 **Java 어댑터는 base URL만 안다.** 실행하면 하네스 스스로 "seed parity — java 백엔드의 스키마 이름을 모른다 (`spec/M4-llm.md`로 이관)"을 찍는다.

**옮겨 적을 필요는 없다** — `spec/M4-llm.md`가 이미 제어 표면 5개를 transport 형태(`POST /__harness/<name>`)와 요청·응답 스키마까지 완료 기준으로 갖고 있다. M2는 이 항목을 **갖지 않는 것이 맞다.**

### 결정 기록
- [ ] 시계 소스 policy matrix와 근거가 `spec/M2-findings.md`에 있고, `updated_at >= created_at` 테스트가 있다
- [ ] `SKIP LOCKED` 결정과 근거가 있고, **2건 경합 판별 테스트**가 있다
- [ ] JSONB canonical 표현 결정과 근거가 있다

## 검증 방법

```bash
cd apps/api-java
REQUIRE_ALEMBIC_CHECK=1 ./gradlew test     # Testcontainers — Docker 필요
# FastApiInteropIT 가 이 안에서 uvicorn 을 직접 띄우므로 apps/api 는 uv sync 돼 있어야 한다

# 하네스 비교 — Java 를 하네스 DB·스텁 모델명으로 띄운다
DATABASE_URL='postgresql://acttub:acttub@localhost:55432/harness_claude' \
JWT_SECRET='harness-secret' \
GEMINI_MODEL='harness-summary-model' \
SERVER_PORT=8099 ./gradlew bootRun &

cd ../../tools/contract-harness
../../apps/api/.venv/bin/python -m contract_harness \
    --baseline fastapi --target java --only health \
    --java-base-url http://127.0.0.1:8099
```

명령 형태에 함정이 둘 있다. **`--only`는 경로가 아니라 시나리오 이름을 받고**(`health`·`refresh-rotation`·`token-corpus` 등 26종), **`action="append"`라 콤마로 묶이지 않는다** — 여러 개면 `--only a --only b`로 반복한다. 초판은 `--only /v2/auth,/health`라고 적어 두 가지를 동시에 틀렸고, 그대로는 `알 수 없는 시나리오`로 즉시 실패한다.

`GEMINI_MODEL`을 하네스 값(`tools/contract-harness/contract_harness/config.py:SUMMARY_MODEL`)과 맞추지 않으면 `/health` 응답의 `$.model`에서 L2 diff가 난다 — 계약 결함이 아니라 설정 불일치다.

스키마 무변경 확인 — **양쪽을 같은 canonical 덤프 함수로 뽑는다.** 옵션 없는 `pg_dump` 비교는 정상 baseline에서도 diff가 난다(`flyway_schema_history` 신규 생성, PG18의 `\restrict`/`\unrestrict`와 `SET` 프리앰블):

```bash
# regen-baseline.sh 와 같은 정규화를 쓴다:
#   --schema-only --no-owner --no-privileges + 메타 테이블·프리앰블 제거
apps/api-java/scripts/canonical-dump.sh <db> > before.sql
# Flyway baseline 적용
apps/api-java/scripts/canonical-dump.sh <db> > after.sql
diff before.sql after.sql          # 비어 있어야 한다
```
