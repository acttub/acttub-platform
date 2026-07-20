# acting-api

acting-summary / acting-agent / acting-report 엔진을 재사용하는 플랫폼 v2 API.
보호 경로는 Bearer access token을 사용하며 v1 HTTP API는 제공하지 않습니다.

## 실행

```bash
uv sync
DATABASE_URL=postgresql://localhost/acting uv run alembic -c acting-api/alembic.ini upgrade head
DEVELOPMENT_AUTH_PROVIDER=1 DATABASE_URL=postgresql://localhost/acting JWT_SECRET=... GEMINI_API_KEY=... S3_BUCKET=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=ap-northeast-2 uv run uvicorn acting_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

### 환경 변수

- `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`는 필수이며, 누락 시 앱이 기동하지 않습니다.
- `GOOGLE_OAUTH_CLIENT_ID`는 선택 override입니다. 미설정 시 웹과 동일한 공개 OAuth client ID를 기본값으로 사용합니다.
- `DEVELOPMENT_AUTH_PROVIDER`는 선택 사항이며 기본값은 비활성입니다. `1` 또는 `true`일 때만 로컬 개발용 `development` 로그인 provider를 등록합니다.
- S3 설정 4개는 선택 사항이지만 일부만 설정할 수는 없습니다. 미설정 상태에서는 앱은 기동하고 업로드·재생 API가 503을 반환하며 분석 워커는 시작하지 않습니다.
- 분석 워커는 `ANALYSIS_WORKER_CONCURRENCY`(기본 1), `ANALYSIS_WORKER_POLL_INTERVAL_SEC`(기본 2초), `ANALYSIS_LEASE_SEC`(기본 1800초), `ANALYSIS_SWEEP_INTERVAL_SEC`(기본 60초)로 조정합니다. 기본 lease는 100MB 다운로드·최대 600초 압축·Gemini 업로드와 ACTIVE 대기 최악 시간을 한 번의 선점 안에 수용하도록 잡았습니다.
- `KEEP_ALIVE_URL`을 설정하면 기존 self-ping이 활성화됩니다. EC2 상시 가동에서는 불필요하지만 제거 결정 전까지 opt-in으로 유지합니다.
- `postgres://`와 `postgresql://` URL은 SQLAlchemy psycopg3 드라이버 URL로 정규화됩니다.

## 약관 관리

```bash
uv run python -m acting_api.consents publish --type terms --version 1 --title "이용약관" --file terms.md --required
uv run python -m acting_api.consents list
```

두 명령 모두 `DATABASE_URL`만 필요합니다.

## 인증과 제한

- 로그인·refresh는 토큰에서 사용자를 확인한 뒤, logout과 나머지 보호 API는 Bearer access token에서 사용자를 확인한 뒤 동일한 사용자별 60회/분 제한을 적용합니다.
- 로그인 전 최신 약관을 보여줘야 하는 `GET /v2/consents/documents`와 `/health`·API 문서는 공개입니다.
- 다른 사용자의 upload intent, practice session, summary, coach session은 존재 여부를 노출하지 않고 404를 반환합니다.

## 로컬 개발 인증

실제 Google ID token 없이 Swagger나 프론트엔드를 개발할 때만 앱 실행 환경에
`DEVELOPMENT_AUTH_PROVIDER=1`을 설정합니다. 이후 일반 로그인 엔드포인트에 다음 형식의 가짜
ID token을 보냅니다.

- `<uid>`: 이메일 없는 미검증 사용자
- `<uid>:<email>`: 검증된 이메일을 가진 사용자

```bash
curl -X POST http://127.0.0.1:8000/v2/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"provider":"development","id_token":"local-user:actor@example.com"}'
```

응답 JWT, 자동 가입·기존 계정 연결, pending consent, rate limit은 Google 로그인과
같은 코드 경로를 사용합니다. **이 provider는 신원을 검증하지 않으므로 프로덕션에서는
절대 `DEVELOPMENT_AUTH_PROVIDER`를 활성화하지 마세요. 배포 환경에 과거 로컬 인증
플래그가 남아 있다면 새 키로 교체하지 말고 제거하세요. 플래그가 없거나 다른 값이면
`development` 로그인은 `400 unsupported_provider`로 거부됩니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /health | 상태 확인 (인증 불필요) |
| GET | /docs | Swagger 문서 (인증 불필요) |
| POST | /v2/auth/login | 구글 OIDC 로그인 및 JWT 쌍 발급 |
| POST | /v2/auth/refresh | refresh token 회전 |
| POST | /v2/auth/logout | refresh token 폐기 |
| GET | /v2/consents/documents | 최신 약관 목록 (인증 불필요) |
| POST | /v2/consents | 동의·거부·철회 이벤트 기록 |
| POST | /v2/uploads/intents | S3 presigned PUT URL 발급 |
| POST | /v2/uploads/intents/{id}/complete | S3 존재·크기·ETag 검증 후 업로드 확정 |
| POST | /v2/practice-sessions | 세션 생성과 비동기 분석 요청 |
| GET | /v2/practice-sessions | 내 세션 최신순 목록 |
| GET | /v2/practice-sessions/{id} | 세션 상태·재생 URL·분석 결과 조회 |
| POST | /v2/practice-sessions/{id}/analyze | 실패 세션 재분석 |
| DELETE | /v2/practice-sessions/{id} | 세션 소프트 삭제 |
| POST | /v2/coach/start | 내 summary로 코치 대화 시작 |
| POST | /v2/coach/reply | 내 코치 세션에 답변 |
| POST | /v2/reports | 종료된 내 코치 세션의 리포트 생성 |
| GET | /v2/reports | 내 리포트 이력 조회 |

연습 세션 생성과 재분석 요청은 202를 반환합니다. 클라이언트는 `GET /v2/practice-sessions/{id}`를 약 10초 간격으로 조회하며, 실패 시 `gemini_timeout`, `gemini_parse_error`, `unsupported_media`, `max_attempts_exceeded` 중 하나를 `error_code`로 받습니다.

## 호출 예시

```bash
# 1) 분석된 연습 세션의 summary_id로 코치 대화 시작
curl -X POST https://<host>/v2/coach/start \
  -H "Authorization: Bearer <access-token>" \
  -H "X-Request-Id: <uuid>" -H "Content-Type: application/json" \
  -d '{"summary_id": "<summary_id>"}'

# 2) 대화 이어가기
curl -X POST https://<host>/v2/coach/reply \
  -H "Authorization: Bearer <access-token>" \
  -H "X-Request-Id: <uuid>" -H "Content-Type: application/json" \
  -d '{"session_id": "<1의 session_id>", "text": "대사가 기억 안 났어요"}'

# 3) 리포트 생성 (세션이 close된 뒤)
curl -X POST https://<host>/v2/reports \
  -H "Authorization: Bearer <access-token>" \
  -H "X-Request-Id: <uuid>" -H "Content-Type: application/json" \
  -d '{"session_id": "<session_id>"}'
```

## 테스트

```bash
UV_CACHE_DIR=/tmp/acting-api-uv-cache uv run --no-sync pytest
RUN_DB_TESTS=1 TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/acting_test \
  UV_CACHE_DIR=/tmp/acting-api-uv-cache uv run --no-sync pytest
```

DB 통합 테스트는 `RUN_DB_TESTS=1`이 없으면 skip됩니다.

## 구조

- 루트 uv workspace가 네 프로젝트를 관리합니다. v2 라우터는 하위 프로젝트의 엔진과 요청 스키마만 import해 사용합니다.
- genai 클라이언트 1개를 분석 워커와 코치·리포트 엔진에 공유 주입합니다.
- SQLAlchemy v2 스키마 13개 테이블·엔진·Alembic·PostgreSQL store는 acting-api에만 두고, 동일 store를 라우터에 주입합니다.
- 보호된 v2 API의 사용자별 rate limit은 FastAPI 의존성으로 적용하고, login·refresh·logout은 사용자를 확인한 뒤 같은 limiter를 직접 적용합니다.
- 분석 워커는 S3 응답을 1MiB 청크로 임시 파일에 저장한 뒤 acting-summary에 파일 경로를 전달합니다. 다운로드 응답 ETag가 업로드 확정 시 저장한 ETag와 같을 때만 분석하며, Google GenAI Files API에도 경로를 넘기므로 영상 전체를 Python 메모리에 적재하지 않습니다.
- Gemini 도메인 오류만 공개 error code와 함께 세션을 실패 처리합니다. S3·DB 같은 일시적 인프라 오류나 ETag 변경은 operation을 `pending`으로 되돌려 시도 예산 안에서 재선점하고, 3회 소진 시 sweep이 `max_attempts_exceeded`로 마감합니다.
- 첫 번째 워커 스레드는 설정된 sweep 간격마다 만료 upload intent와 최대 시도 횟수 초과 operation을 정리합니다. 만료 intent의 S3 객체는 best-effort로 삭제하고 삭제 실패는 기록하되 DB 만료 처리는 유지합니다. 성공 결과 저장과 세션·operation 상태 변경은 한 DB 트랜잭션으로 마감합니다.
