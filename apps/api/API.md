# acting-api API 문서

연기 피드백 플랫폼 API. 하나의 FastAPI 앱(`acting-api`)이 계정·업로드·분석·코칭·리포트를 단일 엔드포인트로 제공합니다. 분석 파이프라인(acting-summary·acting-agent·acting-report)은 in-process로 임베드되어 있습니다 (HTTP 프록시 아님).

- **Base URL**: EC2 배포 후 확정. 로컬 실행 시 `http://127.0.0.1:8000`
- **사용 흐름**: 로그인 → 업로드 인텐트 → S3 PUT → complete → 연습 세션 생성(분석 시작, 202) → 상태 폴링 → 코칭 대화 → 리포트 생성
- **자동 문서**: `/docs` (Swagger UI), `/redoc`, `/openapi.json`
- **DB 스키마·설계 결정**: [docs/design-decisions.md](docs/design-decisions.md), 시각화는 [spec/api-spec.html](spec/api-spec.html)

---

## 인증 및 공통 규칙

`Authorization: Bearer <access_token>` 헤더를 사용합니다. access 토큰은 30분, refresh 토큰은 14일이며 refresh는 회전(rotation) 방식입니다 — `/v2/auth/refresh`가 매번 새 쌍을 발급하고 이전 refresh 토큰을 폐기합니다. **회전된 refresh 토큰이 재사용되면 탈취로 간주해 해당 사용자의 모든 refresh 토큰을 회수**합니다.

**인증 불필요 (공개)**: `/health`, `/docs`, `/redoc`, `/openapi.json`, `GET /v2/consents/documents`, `/v2/auth/*` (자체 규칙 적용)

| 상태 코드 | 의미 |
|---|---|
| 401 | 토큰 누락·만료·위조, 유효하지 않은 refresh 토큰 — `{"detail": "invalid or missing access token"}` |
| 403 | 정지 계정 — `{"detail": "account_suspended"}` |
| 404 | 존재하지 않거나 **남의 리소스** (존재 노출 방지를 위해 403 대신 404) |
| 429 | rate limit 초과 — `{"detail": "rate limit exceeded"}` |

**rate limit**: 인증된 요청은 **사용자별 60회/분** (인메모리 고정 윈도우). `/v2/auth/login`·`/v2/auth/refresh`는 인증 전이므로 **클라이언트 IP별 60회/분**이 요청 처리 전에 적용됩니다.

### 멱등성 (X-Request-Id)

AI 호출을 포함한 쓰기 요청(`/v2/practice-sessions`, `/{id}/analyze`, `/v2/coach/*`, `POST /v2/reports`)은 `X-Request-Id: <UUID>` 헤더를 지원합니다. 서버는 (사용자, request_id)별로 작업을 한 번만 만들고, 같은 키의 재요청에는:

| 원 작업 상태 | 비동기 (`/v2/practice-sessions` 계열) | 동기 (`/v2/coach/*`, `/v2/reports`) |
|---|---|---|
| 처리 중 (running) | 같은 202 재반환 | 409 `{"detail": "request is still processing"}` |
| 성공 (succeeded) | 저장된 응답 재반환 (바이트 동일) | 저장된 응답 재반환 (바이트 동일) |
| 실패 (failed) | 재실행 | 재실행 |

- 같은 request_id를 **다른 본문**으로 재사용하면 422 `request_fingerprint_mismatch`.
- 형식이 UUID가 아니면 422 `invalid X-Request-Id`.
- 헤더를 생략하면 서버가 UUID를 생성하고 응답의 `X-Request-Id` 헤더로 돌려줍니다 (이 경우 멱등 재시도는 불가).

---

## GET /health

인증 불필요. 헬스체크 용도.

```json
{"status": "ok", "services": ["summary", "coach", "report"], "model": "gemini-2.5-flash", "keep_alive": false, "commit": "unknown"}
```

---

## POST /v2/auth/login

소셜 로그인. 별도 회원가입 없이 첫 로그인 시 자동으로 계정이 생성됩니다. 1차 지원 provider는 `google`뿐입니다 (카카오·애플은 후속).

### 요청 — JSON

| 필드 | 타입 | 설명 |
|---|---|---|
| `provider` | str | `"google"` |
| `id_token` | str | 구글 OIDC id_token. 서버가 서명·issuer·audience·만료를 검증 |

### 처리 규칙

- `(provider, provider_uid)`가 이미 등록돼 있으면 그 계정으로 로그인.
- 처음이면: id_token의 이메일이 기존 계정과 일치할 때 **email_verified가 참인 경우에만** 기존 계정에 identity를 자동 연결, 미검증이면 409. 그 외에는 신규 계정 생성 (이메일은 검증된 경우에만 저장, 아니면 NULL).

### 응답 200

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 1800,
  "user": {"id": "...", "email": "actor@example.com", "status": "active"},
  "pending_consents": [
    {"id": "...", "type": "terms", "version": "draft-1", "title": "...", "body": "...", "required": true, "published_at": "..."}
  ]
}
```

- `pending_consents`: 필수 약관 중 아직 동의(granted)하지 않은 최신 문서 목록. 비어 있지 않으면 앱이 동의 화면을 띄우고 `POST /v2/consents`로 기록.

### 오류

| 상태 코드 | 원인 |
|---|---|
| 400 | 지원하지 않는 provider — `unsupported_provider` |
| 401 | id_token 검증 실패 — `invalid_provider_token` |
| 403 | 정지 계정 — `account_suspended` |
| 409 | 같은 이메일의 기존 계정 + 미검증 이메일 — `account_exists_with_different_provider` |
| 429 | IP별 한도 초과 |
| 503 | `GOOGLE_OAUTH_CLIENT_ID` 미설정 — `provider_not_configured` |

---

## POST /v2/auth/refresh

refresh 토큰 회전 재발급.

**요청**: `{"refresh_token": "..."}` → **응답 200**: `{"access_token", "refresh_token", "token_type", "expires_in"}` (새 쌍)

만료·폐기·미존재·재사용된 토큰은 전부 401 `invalid_refresh_token` (재사용 감지 시 사용자 토큰 전체 회수 후 401). 정지 계정 403. IP별 rate limit 적용.

---

## POST /v2/auth/logout

인증 필요. `{"refresh_token": "..."}` 를 폐기하고 **204**. 본인 것이 아니거나 이미 무효면 401.

---

## GET /v2/consents/documents

인증 불필요 (로그인 전 약관 표시용). 약관 type별 최신 버전 목록.

```json
{"documents": [{"id": "...", "type": "terms", "version": "1", "title": "...", "body": "...", "required": true, "published_at": "..."}]}
```

약관 게시는 관리 CLI로 합니다: `uv run python -m acting_api.consents publish --type terms --version <v> --title <t> --file <md> [--required]` (목록은 `list`).

---

## POST /v2/consents

인증 필요. 동의·거부·철회 이벤트를 기록합니다 (INSERT-only 이력).

**요청**: `{"document_id": "<uuid>", "action": "granted" | "declined" | "revoked"}`

**응답 201**: `{"id", "document_id", "action", "occurred_at"}` · 문서가 없으면 404.

---

## POST /v2/uploads/intents

S3 presigned 업로드 URL 발급. 서버는 영상 바이트를 받지 않습니다 — 앱이 응답의 `upload_url`로 S3에 직접 PUT 합니다.

**요청**: `{"mime_type": "video/mp4", "size_bytes": 123456789, "duration_ms": 95000}` (`duration_ms` 선택)

**응답 201**:

```json
{"intent_id": "...", "upload_url": "https://<bucket>.s3....(서명된 PUT URL)", "expires_at": "..."}
```

- 인텐트·URL 만료는 **30분**. PUT 시 `Content-Type`·`Content-Length`가 요청 값과 일치해야 합니다.

| 상태 코드 | 원인 |
|---|---|
| 413 | 550MB 초과 — `upload_too_large` |
| 415 | `video/*`가 아닌 mime_type — `unsupported_media_type` |
| 503 | S3 미설정 — `storage_not_configured` |

---

## POST /v2/uploads/intents/{intent_id}/complete

S3 업로드 완료 확인. 서버가 S3 HEAD로 객체 존재·크기 일치를 검증하고 **ETag를 기록**해 이후 내용 교체를 차단합니다.

**응답 200**: `{"intent_id": "...", "status": "finalized"}` — 이미 finalized인 인텐트에 다시 호출해도 같은 200 (멱등).

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 인텐트 — `upload_intent_not_found` |
| 409 | 만료 — `upload_intent_expired` / 객체 없음 — `upload_not_found` / 크기 불일치 — `upload_size_mismatch` |

---

## POST /v2/practice-sessions

연습 세션 생성 + 분석 **비동기** 시작.

**요청**: `{"upload_intent_id": "...", "situation": "...", "character_context": "...", "subtext": "..."}`

**응답 202**: `{"session_id": "...", "status": "analyzing"}`

분석은 백그라운드 워커가 수행하며(수 분 소요), 완료 여부는 `GET /v2/practice-sessions/{id}`를 **10초 간격** 폴링으로 확인합니다.

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 upload intent — `upload_intent_not_found` |
| 409 | 인텐트 미확정(finalized 아님)·이미 다른 세션에 사용됨 — `upload_intent_not_finalized_or_already_used` |
| 422 | fingerprint 불일치 — `request_fingerprint_mismatch` |

---

## GET /v2/practice-sessions

내 세션 목록 (삭제된 것 제외, 최신순).

```json
{"sessions": [{"session_id": "...", "status": "analyzed", "situation": "...", "character_context": "...", "subtext": "...", "created_at": "...", "updated_at": "..."}]}
```

---

## GET /v2/practice-sessions/{session_id}

세션 상세 + 서명된 재생 URL(15분 유효) + 분석 상태.

```json
{
  "session_id": "...", "status": "analyzed",
  "situation": "...", "character_context": "...", "subtext": "...",
  "playback_url": "https://...(서명된 GET URL)",
  "created_at": "...", "updated_at": "...",
  "summary": {"summary_id": "...", "observation": {...}, "summary": "...", "intent_alignment": "...", "key_moment": "...", "key_dimension": "...", "anomalies": [...]}
}
```

- `status`: `created | analyzing | analyzed | failed`
- `summary`: **analyzed일 때만** 포함 (최신 분석 결과 + `summary_id` — `/v2/coach/start`에 사용)
- `error_code`: **failed일 때만** 포함 — `gemini_timeout` · `gemini_parse_error` · `unsupported_media` · `max_attempts_exceeded`
- 없는·남의·삭제된 세션 404, S3 미설정 503

---

## POST /v2/practice-sessions/{session_id}/analyze

**재분석** — status가 `failed`일 때만. 영상 재업로드 없이 새 분석 작업을 시작하고 202 반환 (summaries는 세션당 1:N 누적, 조회는 항상 최신).

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 세션 |
| 409 | failed 상태가 아님 — `session_is_not_failed` / 재시도 소진 — `analysis_retry_exhausted` |

---

## DELETE /v2/practice-sessions/{session_id}

소프트 삭제 (숨김) → **204**. 이후 목록·상세에서 404.

---

## POST /v2/coach/start

분석 요약을 바탕으로 코칭 대화를 시작합니다. 동기 호출.

**요청**: `{"summary_id": "<GET 세션 상세의 summary_id>"}`

**응답 200**:

```json
{"session_id": "...", "action": "probe_intent", "utterance": "...", "focus_timestamp": "00:17", "done": false, "reason": null}
```

- `action`: `probe_intent | dig_cause | deflect | close`
- `reason` (done=true일 때): `gap_stated | exhausted | limit | user_ended`

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 summary — `summary not found` |
| 409 | 같은 X-Request-Id가 처리 중 — `request is still processing` |
| 502 | Gemini 응답 파싱 실패 |

---

## POST /v2/coach/reply

배우의 답변을 전달하고 다음 코치 발화를 받습니다.

**요청**: `{"session_id": "...", "text": "..."}` → **응답 200**: `/v2/coach/start`와 동일 형태.

종료 규칙: 답변에 `그만`·`종료`·`끝` 포함 → `user_ended`, 질문 10회 도달 → `limit`, 종료된 세션에 재요청 → `action: "close", done: true`.

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 세션 — `session not found` |
| 409 | 동시 변경 — `session changed concurrently` / 같은 X-Request-Id 처리 중 |
| 502 | Gemini 응답 파싱 실패 |

---

## POST /v2/reports

종료된 코칭 세션으로 최종 리포트를 생성합니다. 같은 사용자의 이전 리포트가 있으면 `comparison`이 채워집니다.

**요청**: `{"session_id": "<코칭 session_id>"}`

**응답 200**:

```json
{
  "report": {"headline": "...", "biggest_problem": {"start": "00:17", "end": "00:26", "dimension": "...", "description": "..."}, "evidence": "...", "self_discovery": "...", "encouragement": "...", "next_step": "...", "comparison": ""},
  "report_count": 1
}
```

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 세션 — `session not found` |
| 409 | 세션 미종료 — `session is still open` / 리포트 중복 — `report already exists for session` / 같은 X-Request-Id 처리 중 |
| 502 | Gemini 응답 파싱 실패 |

---

## GET /v2/reports

내 리포트 이력 (토큰 사용자 기준, 오래된 순).

```json
{"count": 2, "reports": [{"created_at": "...", "session_id": "...", "report": {...}, "turns": [...]}]}
```

---

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL URL (`postgres://`·`postgresql://`는 psycopg3 URL로 정규화). 없으면 기동 실패 |
| `JWT_SECRET` | ✅ | — | HS256 서명 키. 없으면 기동 실패 |
| `GEMINI_API_KEY` | ✅ | — | Gemini API 키. 없으면 기동 실패 |
| `GOOGLE_OAUTH_CLIENT_ID` | 로그인 시 | — | 구글 id_token audience 검증. 미설정 시 로그인 503 |
| `S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | 업로드·분석 시 | — | **4개 모두 설정하거나 전부 생략** (일부만이면 기동 실패). 미설정 시 업로드·재생 API 503, 분석 워커 비활성 |
| `GEMINI_MODEL` | | `gemini-2.5-flash` | 사용 모델 |
| `COACH_MAX_QUESTIONS` | | `10` | 코치 최대 질문 수 |
| `ANALYSIS_WORKER_CONCURRENCY` | | `1` | 동시 분석 개수 |
| `ANALYSIS_WORKER_POLL_INTERVAL_SEC` | | `2` | 워커 폴링 주기 |
| `ANALYSIS_LEASE_SEC` | | `1800` | 분석 lease 길이 |
| `ANALYSIS_SWEEP_INTERVAL_SEC` | | `60` | 만료 인텐트·초과 시도 스윕 주기 |
| `KEEP_ALIVE_URL` / `KEEP_ALIVE_INTERVAL_SEC` | | — / `600` | 설정 시에만 self-ping (EC2 상시 가동에선 불필요) |

## 제한 요약

| 항목 | 값 |
|---|---|
| 영상 업로드 상한 | 550MB (초과 시 413), `video/*`만 |
| 업로드 인텐트·presigned PUT 만료 | 30분 |
| 재생 URL 유효 | 15분 |
| 분석 시도 상한 | 작업당 3회 (초과 시 `max_attempts_exceeded`) |
| 코치 질문 상한 | 10회 |
| rate limit | 사용자별 60회/분, login·refresh는 IP별 60회/분 |

---

## 호출 예시 (curl)

```bash
BASE=http://127.0.0.1:8000

# 1. 로그인 (구글 id_token) → access_token / refresh_token
curl -X POST $BASE/v2/auth/login -H "Content-Type: application/json" \
  -d '{"provider": "google", "id_token": "<구글 id_token>"}'
TOKEN=<access_token>

# 2. 업로드 인텐트 → 받은 upload_url로 영상을 직접 PUT
curl -X POST $BASE/v2/uploads/intents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mime_type": "video/mp4", "size_bytes": 12345678}'
curl -X PUT "<upload_url>" -H "Content-Type: video/mp4" --data-binary @scene.mp4

# 3. 업로드 완료 확인
curl -X POST $BASE/v2/uploads/intents/<intent_id>/complete -H "Authorization: Bearer $TOKEN"

# 4. 연습 세션 생성 (분석 시작, 202)
curl -X POST $BASE/v2/practice-sessions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "X-Request-Id: $(uuidgen)" \
  -d '{"upload_intent_id": "<intent_id>", "situation": "이별 통보를 받은 직후", "character_context": "감정을 억누르는 30대 직장인", "subtext": "붙잡고 싶지만 자존심 때문에 말하지 못한다"}'

# 5. 분석 완료까지 10초 간격 폴링 → analyzed면 summary_id 획득
curl $BASE/v2/practice-sessions/<session_id> -H "Authorization: Bearer $TOKEN"

# 6. 코칭 시작·답변
curl -X POST $BASE/v2/coach/start -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"summary_id": "<summary_id>"}'
curl -X POST $BASE/v2/coach/reply -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"session_id": "<coach_session_id>", "text": "긴장해서 그랬어요"}'

# 7. 리포트 생성·이력
curl -X POST $BASE/v2/reports -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"session_id": "<coach_session_id>"}'
curl $BASE/v2/reports -H "Authorization: Bearer $TOKEN"
```
