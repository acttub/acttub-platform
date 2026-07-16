# acting-api API 문서

연기 피드백 파이프라인 게이트웨이 API. 하나의 FastAPI 앱(`acting-api`)이 세 서비스의 라우터를 in-process로 마운트해 단일 엔드포인트로 제공합니다 (HTTP 프록시 아님).

- **Base URL**: `https://acting-api.onrender.com`
- **사용 흐름**: `POST /summarize` (영상 분석) → `POST /coach/start` / `POST /coach/reply` (코칭 대화) → `POST /report` (리포트 생성)
- **자동 문서**: `/docs` (Swagger UI), `/redoc`, `/openapi.json`

---

## 인증 및 공통 규칙

`/health`, `/docs`, `/openapi.json`, `/redoc`을 제외한 **모든 요청에 `X-API-Key` 헤더 필수**.

| 상태 코드 | 의미 | 응답 본문 |
|---|---|---|
| 401 | API 키 누락/불일치 | `{"detail": "invalid or missing X-API-Key"}` |
| 429 | DB에 설정된 해당 키의 분당 요청 한도 초과 (고정 1분 윈도우) | `{"detail": "rate limit exceeded"}` |

서버는 평문 키를 SHA-256으로 해시한 뒤 `api_keys` 테이블에서 활성 키와 키별 한도를 조회합니다. 평문 키는 DB에 저장하지 않습니다. 레이트리밋 카운터는 인메모리 방식이라 인스턴스 재시작 시 초기화됩니다.

API 키 관리 CLI (`DATABASE_URL` 필수):

```bash
uv run python -m acting_api.api_keys issue --label local --rate-limit-per-min 10
uv run python -m acting_api.api_keys list
uv run python -m acting_api.api_keys revoke <api-key-uuid>
```

발급 명령의 평문 키는 이때 한 번만 출력됩니다.

---

## GET /health

인증 불필요. Render 헬스체크 및 keep-alive 용도.

**응답 200**

```json
{
  "status": "ok",
  "services": ["summary", "coach", "report"],
  "model": "gemini-2.5-flash",
  "keep_alive": true,
  "commit": "d9b1de9"
}
```

- `commit`: `RENDER_GIT_COMMIT` 앞 7자 (없으면 `"unknown"`)

---

## POST /summarize

연기 영상을 업로드하면 Gemini가 장면을 분석해 구조화된 요약(`SceneSummary`)을 반환합니다.

### 요청 — `multipart/form-data`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_id` | text | ✅ | 외부 사용자 ID. 처음 보는 값이면 서버가 사용자를 생성 |
| `situation` | text | ✅ | 상황 |
| `character` | text | ✅ | 인물설정 |
| `subtext` | text | ✅ | 서브텍스트 |
| `video` | file | ✅ | 연기 영상 (확장자 없으면 `.mp4`로 처리) |

**업로드 제한**: 최대 **550MB**. `Content-Length` 선검사 + 1MB 청크 스트리밍 중 누적 검사로 이중 적용.

**서버 측 처리** (응답 지연에 영향):
- 15MB 초과 영상은 ffmpeg로 압축 후 Gemini 업로드 (768px / 10fps / 모노 오디오, 타임아웃 300초, 동시 1건만 실행). 실패 시 원본 사용.
- Gemini Files API 업로드 후 ACTIVE 상태를 최대 300초 대기 (2초 간격 폴링).
- 대용량 영상은 전체 처리에 수 분 소요될 수 있으므로 클라이언트 타임아웃을 넉넉히 설정할 것.

### 응답 200 — `SceneSummary` + `summary_id`

```json
{
  "summary_id": "11111111-1111-4111-8111-111111111111",
  "observation": {
    "timeline": "...",
    "dialogue": "...",
    "tempo": "...",
    "pitch": "...",
    "movement": "...",
    "expression": "...",
    "emotion": "...",
    "extra": [{ "name": "...", "observation": "..." }]
  },
  "summary": "...",
  "intent_alignment": "...",
  "key_moment": "...",
  "key_dimension": "...",
  "anomalies": [
    {
      "start": "00:17",
      "end": "00:26",
      "dimension": "...",
      "what": "...",
      "why_odd": "...",
      "likely_cause": "...",
      "impact_on_intent": "...",
      "overlaps_key_moment": false,
      "on_key_dimension": true,
      "intent_impact": "약화",
      "severity": "high",
      "severity_reason": "..."
    }
  ]
}
```

- `intent_impact`: `"반전" | "약화" | "국소"`
- `severity`: `"high" | "mid" | "low"` — 서버가 규칙 기반으로 재계산·정렬 (severity 내림차순 → 시작 시각 → 축 순서)
- `summary_id`: 저장된 요약의 표준 UUID. 이후 `/coach/start`에서 사용
- 서버는 이 요청에서 사용자·장면·요약·이상 구간을 PostgreSQL에 한 번 INSERT하며, 이후 코치·리포트 단계에서 요약을 수정하지 않습니다.

### 오류

| 상태 코드 | 원인 | 응답 본문 |
|---|---|---|
| 413 | 550MB 초과 | `{"detail": "영상이 550MB를 넘어요. 한 장면(3분 이내)만 잘라서 다시 올려주세요."}` |
| 504 | Gemini 파일 처리 타임아웃 (300초) | `{"detail": "<메시지>"}` |
| 502 | Gemini 응답 파싱 실패 (2회 재시도 후) | `{"detail": "<메시지>"}` |

---

## POST /coach/start

요약 결과를 바탕으로 코칭 대화 세션을 시작합니다.

### 요청 — JSON

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `summary_id` | UUID 문자열 | ✅ | `/summarize` 응답의 `summary_id` |

서버가 저장된 요약과 장면의 `situation`·`character`·`subtext`를 조인해 로드합니다. 요약 객체를 함께 보내는 구형 요청은 허용하지 않습니다.

### 응답 200

```json
{
  "session_id": "22222222-2222-4222-8222-222222222222",
  "action": "probe_intent",
  "utterance": "그 장면에서 어떤 의도로...",
  "focus_timestamp": "00:17",
  "done": false,
  "reason": null
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `session_id` | UUID 문자열 | 이후 `/coach/reply`, `/report`에서 사용 |
| `action` | enum | `"probe_intent" \| "dig_cause" \| "deflect" \| "close"` |
| `utterance` | str | 코치 발화 |
| `focus_timestamp` | str | 언급 구간 타임스탬프 (기본 `""`) |
| `done` | bool | 대화 종료 여부 |
| `reason` | enum \| null | 종료 사유: `"gap_stated" \| "exhausted" \| "limit" \| "user_ended"` |

### 오류

| 상태 코드 | 원인 | 응답 본문 |
|---|---|---|
| 404 | 저장된 요약 없음 | `{"detail": "summary not found"}` |
| 502 | Gemini 응답 파싱 실패 | `{"detail": "<메시지>"}` |

---

## POST /coach/reply

배우의 답변을 전달하고 코치의 다음 발화를 받습니다.

### 요청 — JSON

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `session_id` | UUID 문자열 | ✅ | `/coach/start`에서 받은 세션 ID |
| `text` | str | ✅ | 배우의 답변 |

### 응답 200

`/coach/start`와 동일한 형태.

**대화 종료 규칙**:
- 답변에 `그만`, `종료`, `끝` 포함 → `done: true`, `reason: "user_ended"`
- 질문 횟수 10회 도달 (`COACH_MAX_QUESTIONS`) → `done: true`, `reason: "limit"`
- 이미 종료된 세션에 요청 → `action: "close"`, `done: true` 반환

### 오류

| 상태 코드 | 원인 | 응답 본문 |
|---|---|---|
| 404 | 세션 없음 | `{"detail": "session not found"}` |
| 409 | 동일 세션이 다른 요청에서 먼저 변경됨 | `{"detail": "session changed concurrently"}` |
| 502 | Gemini 응답 파싱 실패 | `{"detail": "<메시지>"}` |

세션과 턴은 PostgreSQL에 저장되므로 서버 재시작 후에도 같은 `session_id`로 이어갈 수 있습니다.

---

## POST /report

저장된 코칭 세션으로 최종 연기 리포트를 생성합니다. 서버가 세션→요약→장면→사용자 사슬에서 대화·요약·`user_id`를 로드하며, 같은 사용자의 이전 리포트가 있으면 비교(`comparison`)가 포함됩니다.

### 요청 — JSON

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `session_id` | UUID 문자열 | ✅ | `/coach/start`에서 받은 세션 ID |

`user_id`, 요약 또는 대화 전체를 함께 보내는 구형 요청은 허용하지 않습니다.

### 응답 200

```json
{
  "user_id": "user-123",
  "report": {
    "headline": "...",
    "biggest_problem": {
      "start": "00:17",
      "end": "00:26",
      "dimension": "...",
      "description": "..."
    },
    "evidence": "...",
    "self_discovery": "...",
    "encouragement": "...",
    "next_step": "...",
    "comparison": ""
  },
  "report_count": 1
}
```

- `comparison`: 이전 리포트가 있을 때만 채워짐
- `report_count`: 해당 사용자의 누적 리포트 수

### 오류

| 상태 코드 | 원인 | 응답 본문 |
|---|---|---|
| 404 | 저장된 세션 없음 | `{"detail": "session not found"}` |
| 409 | 코칭 세션이 아직 종료되지 않음 | `{"detail": "session is still open"}` |
| 409 | 같은 세션의 리포트가 이미 존재 | `{"detail": "report already exists for session"}` |
| 502 | Gemini 응답 파싱 실패 | `{"detail": "<메시지>"}` |

---

## GET /report/history/{user_id}

사용자의 리포트 이력을 조회합니다.

### 응답 200

```json
{
  "user_id": "user-123",
  "count": 2,
  "reports": [
    {
      "created_at": "2026-07-13T04:00:00+00:00",
      "session_id": "22222222-2222-4222-8222-222222222222",
      "report": { "...": "ActingReport" },
      "turns": []
    }
  ]
}
```

- 존재하지 않는 사용자도 404가 아닌 `count: 0`, 빈 배열 반환.

이력은 PostgreSQL에서 사용자→장면→요약→세션→리포트 사슬을 조인해 조회합니다.

---

## 환경 변수

| 변수 | 서비스 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | acting-api/Alembic/CLI | **필수** (없으면 기동 실패) | PostgreSQL 연결 URL. `postgres://`/`postgresql://`는 psycopg3 URL로 정규화 |
| `KEEP_ALIVE_URL` | acting-api | 없음 | 설정 시 600초마다 `<url>/health` 핑 (Render 슬립 방지) |
| `KEEP_ALIVE_INTERVAL_SEC` | acting-api | `600` | keep-alive 주기 |
| `GEMINI_API_KEY` | 공통 | **필수** (없으면 기동 실패) | Gemini API 키 |
| `GEMINI_MODEL` | 공통 | `gemini-2.5-flash` | 사용 모델 |
| `COACH_MAX_QUESTIONS` | acting_agent | `10` | 코치 최대 질문 수 |

---

## 제한/타임아웃 요약

| 항목 | 값 |
|---|---|
| 영상 업로드 상한 | 550MB (초과 시 413) |
| ffmpeg 압축 | 15MB 초과 시 실행, 타임아웃 300초, 동시 1건 |
| Gemini 파일 ACTIVE 대기 | 최대 300초 (초과 시 504) |
| Gemini 파싱 재시도 | 2회 (실패 시 502) |
| 코치 질문 상한 | 10회 |
| 레이트리밋 | `api_keys.rate_limit_per_min`의 키별 값 (고정 윈도우) |

---

## 호출 예시 (curl)

```bash
# 1. 영상 요약
curl -X POST https://acting-api.onrender.com/summarize \
  -H "X-API-Key: $API_KEY" \
  -F "user_id=user-123" \
  -F "situation=이별 통보를 받은 직후" \
  -F "character=감정을 억누르는 30대 직장인" \
  -F "subtext=붙잡고 싶지만 자존심 때문에 말하지 못한다" \
  -F "video=@scene.mp4" > summary.json

# 2. 코칭 시작 (1의 summary_id 사용)
curl -X POST https://acting-api.onrender.com/coach/start \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"summary_id": "<summary_id>"}'

# 3. 코칭 답변
curl -X POST https://acting-api.onrender.com/coach/reply \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"session_id": "<session_id>", "text": "그 부분은 긴장해서 그랬어요"}'

# 4. 리포트 생성
curl -X POST https://acting-api.onrender.com/report \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"session_id": "<session_id>"}'

# 5. 리포트 이력
curl https://acting-api.onrender.com/report/history/user-123 \
  -H "X-API-Key: $API_KEY"
```

---

## 참고: 스키마 사본 불일치

`SceneSummary`/`Anomaly` 스키마가 세 곳에 수동 복사되어 있으며 서로 완전히 같지 않습니다.

- **acting-summary** (원본 출력): `Anomaly`에 `overlaps_key_moment`, `on_key_dimension`, `intent_impact` 포함. `segment_scan` 없음.
- **acting_agent / acting-report** (사본): 위 세 필드 없음. 대신 `SceneSummary`에 `segment_scan` 필드 존재 (기본 빈 배열).

사본 3벌은 이번 범위에서 유지합니다. DB에는 `/summarize` 원본을 `summaries.raw` JSONB로 온전히 저장하고, acting-api의 store가 코치·리포트 조회 때 해당 서비스의 사본 모델로 파싱합니다. 하류 객체로 DB 요약을 UPDATE/UPSERT하지 않으므로 사본에 없는 필드가 원본 DB에서 유실되지 않습니다.
