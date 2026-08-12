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
| 403 | 정지 계정 — `{"detail": "account_suspended"}` · 탈퇴 계정 — `{"detail": "account_deactivated"}` |
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

소셜 로그인. 별도 회원가입 없이 첫 로그인 시 자동으로 계정이 생성됩니다. 운영 provider는 `google`·`apple`이며, 로컬에서는 `DEVELOPMENT_AUTH_PROVIDER=1`일 때만 `development`를 추가로 사용할 수 있습니다 (카카오는 후속).

### 요청 — JSON

| 필드 | 타입 | 설명 |
|---|---|---|
| `provider` | str | `"google"` \| `"apple"` (로컬 opt-in: `"development"`) |
| `id_token` | str | google=OIDC id_token, apple="Sign in with Apple" identityToken(JWT — 네이티브는 앱 SDK, 웹은 Apple JS가 발급). development는 로컬 테스트 토큰(`<uid>` 또는 `<uid>:<email>`)이며 email은 미검증으로 취급되어 기존 계정에 자동 연결되지 않고 신규 계정에도 저장되지 않음 |
| `signup_attribution` | object \| null | 선택. first-touch `utm_source`·`utm_medium`·`utm_campaign`·`utm_content`·`utm_term`, `referrer_host`, `landing_path`, `first_seen_at`(ISO 8601). 신규 계정을 만들 때만 저장 |

### 처리 규칙

- `(provider, provider_uid)`가 이미 등록돼 있으면 그 계정으로 로그인.
- 처음이면: id_token의 이메일이 기존 계정과 일치할 때 **email_verified가 참인 경우에만** 기존 계정에 identity를 자동 연결, 미검증이면 409. 그 외에는 신규 계정 생성 (이메일은 검증된 경우에만 저장, 아니면 NULL).
- `signup_attribution` 문자열은 제어문자를 제거하고 255자로 제한하며 빈 값은 NULL로 저장합니다. 객체가 잘못돼도 유입 정보만 버리고 로그인은 계속합니다. 기존 계정 로그인이나 기존 이메일에 identity를 연결하는 분기에서는 무시합니다.

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
| 403 | 정지 계정 — `account_suspended` · 탈퇴 계정 — `account_deactivated` |
| 409 | 같은 이메일의 기존 계정 + 미검증 이메일 — `account_exists_with_different_provider` |
| 429 | IP별 한도 초과 |

---

## POST /v2/auth/refresh

refresh 토큰 회전 재발급.

**요청**: `{"refresh_token": "..."}` → **응답 200**: `{"access_token", "refresh_token", "token_type", "expires_in"}` (새 쌍)

만료·폐기·미존재·재사용된 토큰은 전부 401 `invalid_refresh_token` (재사용 감지 시 사용자 토큰 전체 회수 후 401). 정지·탈퇴 계정 403. IP별 rate limit 적용.

---

## POST /v2/auth/logout

인증 필요. `{"refresh_token": "..."}` 를 폐기하고 **204**. 본인 것이 아니거나 이미 무효면 401.

---

## GET · PATCH · DELETE /v2/me

인증 필요. 동의 게이트는 걸지 않습니다 — 동의 화면에서 닉네임을 함께 받기 때문입니다.

**GET** → 200 `{"id", "email", "nickname", "status"}`. `status`는 `active` | `suspended` | `deactivated`.

**PATCH** — `{"nickname": "<1~20자>"}`. 앞뒤 공백은 잘리고 가운데 연속 공백은 하나로 접힙니다. 공백만 보내면 422, 사용자 행이 없으면 404 `user_not_found`. 닉네임 중복은 허용합니다.

**DELETE** — 회원탈퇴. **204**를 반환하고 계정을 `deactivated`로 내립니다.

**파기되는 것** (복구 불가):

| 대상 | 처리 |
|---|---|
| `users.email` · `users.nickname` | `NULL` |
| `user_identities` 행 | 삭제 |
| refresh 토큰 | 전부 폐기 |

**남는 것**: `users` 행, 커뮤니티 글·댓글, 연습 기록·리포트·업로드 영상. 글이 참조하는 작성자가 사라지면 남의 글타래가 깨지고, 신고 처리에도 원문 작성자가 필요하기 때문입니다.

- 커뮤니티 응답에서 탈퇴자의 작성자 이름은 **`"탈퇴한 사용자"`**로 나갑니다 (닉네임이 파기됐으므로). 글·댓글 본문과 작성자 `id`는 그대로입니다.
- 이미 발급된 access 토큰은 만료(30분)까지 형식상 유효하지만 모든 인증 경로가 403 `account_deactivated`로 막습니다.
- **같은 소셜 계정으로 다시 가입할 수 있습니다** — identity를 끊었으므로 `/v2/auth/login`이 **새 user**를 만듭니다. 과거 기록과는 이어지지 않습니다.
- 두 번째 호출은 게이트에서 403으로 걸리며, 최초 탈퇴 시각(`deactivated_at`)은 덮이지 않습니다.
- `login`·`refresh`의 403 `account_deactivated`는 identity가 남아 있는 비정상 상태(과거 데이터, 파기 실패)를 막는 방어선으로 유지됩니다.

---

## GET · PUT · DELETE /v2/me/memory

인증 + **동의 필요**. 코치가 연습을 넘어 기억하는 6칸입니다 — 연습 기록에서 파생된 개인 정보라 동의를 마친 계정만 봅니다.

칸은 `gender` · `age` · `goal` · `blockage` · `speech_self` · `speech_actual` 여섯입니다. **에이전트가 채우고 배우가 고칩니다.**

**GET** → 200 `{"items": [...]}`. 아직 채워지지 않은 칸은 **빠진 채로** 옵니다(빈 문자열이 아니라 항목 자체가 없음).

| 필드 | 뜻 |
|---|---|
| `field` | 위 여섯 중 하나 |
| `value` | 내용 |
| `edited_by_me` | `true`면 배우가 직접 쓰거나 고친 칸. **이후 에이전트가 덮지 않습니다** |
| `source_practice_session_id` | 에이전트가 적은 칸의 근거가 된 연습. 배우가 쓴 칸은 `null` |

**PUT `/{field}`** — `{"value": "<1~1000자>"}` → 200. 앞뒤 공백은 잘리고 가운데 연속 공백은 하나로 접힙니다. 공백만 보내거나 1000자를 넘기면 422, 모르는 칸 이름도 422.

여기서 쓴 칸은 `edited_by_me: true`가 되어 **에이전트 갱신에서 제외됩니다.** 되돌리려면 지우면 되고, 지우면 다음 연습부터 에이전트가 다시 채웁니다.

**DELETE `/{field}`** — 한 칸을 지우고 **204**. 이미 없어도 204입니다(지우려는 결과가 같으므로).

**DELETE** — 기억을 통째로 지우고 **204**.

**성별·나이는 배우만 씁니다.** 영상이나 목소리에서 추론하지 않습니다 — 저장 계층이 에이전트 경로를 막고, DB 제약(`ck_actor_memory_demographics_actor_only`)이 최종 방어선입니다.

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
| 413 | 100MB 초과 — `upload_too_large` |
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
| 413 | 현재 상한(100MB) 초과 pending 인텐트(상한 하향 배포 전 발급분) — `upload_too_large` |

---

## POST /v2/practice-sessions

연습 세션 생성 + 분석 **비동기** 시작.

**요청**: `{"upload_intent_id": "...", "situation": "...", "character_context": "...", "goal": "...", "blockage_kind": "분석", "sub_branch": "대사 분석", "blockage_detail": "..."}`

**응답 202**: `{"session_id": "...", "status": "analyzing"}`

분석은 백그라운드 워커가 수행합니다. 코칭은 분석 완료를 기다리지 않고 `session_id`로 즉시 시작할 수 있으며, 분석 상태가 필요한 화면만 `GET /v2/practice-sessions/{id}/status`를 폴링합니다.

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 upload intent — `upload_intent_not_found` |
| 409 | 인텐트 미확정(finalized 아님)·이미 다른 세션에 사용됨 — `upload_intent_not_finalized_or_already_used` |
| 422 | fingerprint 불일치 — `request_fingerprint_mismatch` |

---

## GET /v2/practice-sessions

내 세션 목록 (삭제된 것 제외, 최신순).

```json
{"sessions": [{"session_id": "...", "status": "analyzed", "situation": "...", "character_context": "...", "goal": "...", "created_at": "...", "updated_at": "..."}]}
```

---

## GET /v2/practice-sessions/{session_id}

세션 상세 + 서명된 재생 URL(15분 유효) + 분석 상태.

```json
{
  "session_id": "...", "status": "analyzed",
  "situation": "...", "character_context": "...", "goal": "...",
  "playback_url": "https://...(서명된 GET URL)",
  "created_at": "...", "updated_at": "...",
  "summary": {"summary_id": "...", "observations": [{"start_ms": 120, "end_ms": 430, "label": "대사가 시작된다", "confidence": 0.9}], "uncertainties": []}
}
```

- `status`: `created | analyzing | analyzed | failed`
- `summary`: **analyzed일 때만** 포함하는 최신 관찰 팩. 관찰 0개도 정상입니다.
- `error_code`: **failed일 때만** 포함 — `gemini_timeout` · `gemini_parse_error` · `unsupported_media` · `max_attempts_exceeded`
- 없는·남의·삭제된 세션 404, S3 미설정 503

---

## GET /v2/practice-sessions/{session_id}/status

분석 폴링용 경량 상태 조회. 인증이 필요하며 재생 URL·분석 본문을 조회하거나 S3에 의존하지 않습니다.

```json
{"status": "analyzing", "error_code": null}
```

- `status`: `created | analyzing | analyzed | failed`
- `error_code`: `failed`일 때만 `gemini_timeout` · `gemini_parse_error` · `unsupported_media` · `max_attempts_exceeded`, 그 외 `null`
- 없는·남의·삭제된 세션은 모두 404 `practice_session_not_found`

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

분석이 끝난 연습 세션으로 코칭 대화를 시작합니다. 같은 연습 세션에 열린 코칭 대화가 있으면 가장 먼저 만든 대화와 전체 발화 기록을 이어받으며, 이때 새 코치 발화는 생성하지 않습니다. 분석 실패 세션은 영상 근거 없이 시작할 수 있습니다.

**요청**: `{"practice_session_id": "<연습 세션 ID>", "restart": false}` (`restart` 기본값은 `false`. `true`이면 기존 열린 코칭 대화를 닫고 새로 시작)

**응답 200**:

```json
{"session_id": "...", "message": "그 말을 지금 꺼내는 이유부터 볼게.", "status": "continue", "handoff": null, "report": null, "turns": [{"role": "actor", "text": "..."}, {"role": "ai", "text": "그 말을 지금 꺼내는 이유부터 볼게."}]}
```

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 연습 세션 — `practice session not found` |
| 409 | 분석이 아직 끝나지 않음 — `practice session analysis is not settled` / 해당 연습 세션에 리포트가 이미 있음 — `report already exists for practice session` / 같은 X-Request-Id가 처리 중 — `request is still processing` |
| 502 | Gemini 응답 파싱 실패 |

---

## POST /v2/coach/reply

코치의 첫 발화에 대한 배우의 답을 전달하고 다음 코치 발화를 받습니다.

**요청**: `{"session_id": "...", "text": "..."}`

**응답 200**: `{"session_id": "...", "message": "...", "status": "continue|complete", "handoff": null|{"id":"...","branch_kind":"analysis|expression"}, "report": null|<analysis|expression|blocked>, "turns": [{"role":"actor|ai","text":"..."}]}`. `turns`는 현재까지의 전체 발화를 저장 순서대로 반환합니다.

종료 규칙: 답변에 `그만`·`종료`·`끝`이 포함되면 현재 대화로 handoff를 마무리한다. `status: complete`이면 서버가 handoff를 자동 확인하고 세션을 닫은 뒤 `report`를 같은 응답에 담는다.

| 상태 코드 | 원인 |
|---|---|
| 404 | 없는·남의 세션 — `session not found` |
| 409 | 동시 변경 — `session changed concurrently` / 같은 X-Request-Id 처리 중 |
| 502 | Gemini 응답 파싱 실패 |

---

## POST /v2/reports

종료된 코칭 세션으로 최종 리포트를 생성합니다. 연습 세션당 리포트는 하나만 만들 수 있으며, 같은 사용자의 이전 리포트가 있으면 `comparison`이 채워집니다.

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
{"count": 2, "reports": [{"created_at": "...", "session_id": "...", "practice_session_id": "...", "report": {...}}]}
```

---

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL URL (`postgres://`·`postgresql://`는 psycopg3 URL로 정규화). 없으면 기동 실패 |
| `JWT_SECRET` | ✅ | — | HS256 서명 키. 없으면 기동 실패 |
| `GEMINI_API_KEY` | ✅ | — | Gemini API 키. 없으면 기동 실패 |
| `GOOGLE_OAUTH_CLIENT_ID` | | `462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com` | 구글 id_token audience 검증용 client ID override |
| `APPLE_OAUTH_CLIENT_ID` | | `com.acttub.app` | 애플 identityToken audience override. 네이티브 앱은 번들 ID, 웹은 Services ID이므로 웹 로그인을 켤 때 `com.acttub.app,<Services ID>`처럼 콤마로 함께 지정 |
| `DEVELOPMENT_AUTH_PROVIDER` | | 비활성 | `1` 또는 `true`일 때만 로컬 테스트용 `development` provider 등록. 프로덕션 활성화 금지 |
| `S3_BUCKET` / `AWS_REGION` | 업로드·분석 시 | — | **둘을 함께 설정하거나 함께 생략**. 설정했는데 boto3 기본 자격증명 체인에서 자격증명을 찾지 못하면 기동 실패. 미설정 시 업로드·재생 API 503, 분석 워커 비활성 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | | — | boto3 기본 자격증명 체인의 환경변수 provider. key·secret은 둘을 함께 설정하며, 로컬 개발·role 전환 롤백 때 선택적으로 사용 |
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
| 영상 업로드 상한 | 100MB (초과 시 413), `video/*`만 |
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
  -d '{"upload_intent_id": "<intent_id>", "situation": "이별 통보를 받은 직후", "character_context": "감정을 억누르는 30대 직장인", "goal": "상대가 떠나지 못하게 한다", "blockage_kind": "분석", "sub_branch": "대사 분석", "blockage_detail": "왜 지금 말하는지 모르겠다"}'

# 5. 분석 완료를 기다리지 않고 코칭 시작·답변
curl -X POST $BASE/v2/coach/start -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"practice_session_id": "<session_id>"}'
curl -X POST $BASE/v2/coach/reply -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"session_id": "<coach_session_id>", "text": "긴장해서 그랬어요"}'

# 7. 리포트 생성·이력
curl -X POST $BASE/v2/reports -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"session_id": "<coach_session_id>"}'
curl $BASE/v2/reports -H "Authorization: Bearer $TOKEN"
```
