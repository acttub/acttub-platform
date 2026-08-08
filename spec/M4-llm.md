# M4 — LLM 파이프라인

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M4 사이클에만 적용된다.**

- BASE_REF: `2d0e12a` (2026-08-08 **3차 개정** — `6102ef8`「AI 3개 층을 관찰 팩·질문 대화·연습 카드로 교체한다」를 반영. 2차 개정은 `8fdca45` 기준이었고 그 시점은 `6102ef8` **이전**이었다)

> ⚠ **3차 개정은 "보강"이 아니라 재작성이다.** 2차 개정본은 `SOMA-302`(공급자가 Gemini→OpenAI로 갈린 것)까지만 반영했고, 그보다 **먼저 들어온** `6102ef8`이 AI 3개 층의 산출물 자체를 갈아치운 것을 보지 못했다. 그 결과 이식 대상 파일 넷을 존재하지 않는 이름으로 적었고, 완료 기준의 "결정적 후처리"가 소스에 없는 함수를 가리키고 있었다. `/SPEC.md` §12가 경고한 그대로다 — `check-refs.py`는 200건 전부 통과시켰다. **산문으로 쓴 파일명은 검사 대상이 아니기 때문이다.**

## 이 개정이 고친 것 — 사양이 틀렸던 자리

전부 소스를 직접 읽어 확인했다. 왼쪽은 2차 개정본의 문언이다.

| # | 사양이 적었던 것 | 실제 |
|---|---|---|
| 1 | 이식 대상은 `engine.py`·`targeting.py`·`guard.py`·`prompt.py`·`clip.py`·`knowledge.py` | **넷이 존재하지 않는다.** `6102ef8`이 질문 은행과 코드 타깃 선정을 걷어냈다. 남은 것은 `engine.py`·`prompt.py`·`schema.py`·`store.py`·`config.py`·`summary_schema.py` |
| 2 | summary의 `response_schema = SceneSummary` | **`ObservationPack`**이다. 6축 이상징후가 관찰 팩으로 바뀌었다 (`acting-summary/schema.py:ObservationPack`) |
| 3 | 후처리 `_finalize` — severity 계산(`_IMPACT_POINTS` + key score), anomaly 정렬, **`_AXIS_ORDER` 한글 6축** | **전부 존재하지 않는다.** 실제 후처리는 `acting-summary/summarizer.py:_filter_observations` 하나 — 구간 유효성 검사 + **상한 3개 절단**이다 |
| 4 | (언급 없음) | **응답 캐시가 있다.** `acting-summary/summarizer.py:_cache_path`가 영상 바이트+시스템 프롬프트+프롬프트+모델의 sha256으로 파일을 찾고, 있으면 LLM을 부르지 않는다 |
| 5 | agent는 `response_mime_type` + `response_schema`로 구조화 출력을 받는다 | **평문 호출이다.** OpenAI `POST /v1/responses`에 `{model, instructions, input}` 셋만 보낸다. JSON 강제 수단이 없어 파싱은 전적으로 클라이언트 몫이다 |
| 6 | **형제 스키마 파싱 폴백** — `close` 유무만 다른 모델로 파싱돼 오면 필드를 옮겨 담는다. "이 폴백이 없으면 간헐적으로 실패한다" | **존재하지 않는다.** 실제 폴백 사슬은 셋이다 — ①펜스(` ```json `) 벗기기 ②`message` 없으면 **원문을 그대로 message로** ③검증 실패 시 **재생성 1회** → 그래도 실패면 **안전 문장**(`acting-agent/prompt.py:safe_template`) |
| 7 | 범위는 `/v2/coach/start`·`/v2/coach/reply`·`POST /v2/reports` 셋 | **`POST /v2/coach/confirm`이 빠져 있었다**(`coaching.py:build_router.coach_confirm`). 그리고 리포트 생성은 이 넷 **전부**에서 일어난다 — coach 턴이 `complete`로 닫히면 그 자리에서 리포트를 만든다 |
| 8 | (언급 없음) | **음성 전사 층이 통째로 새로 생겼다.** `analysis_worker.py:TRANSCRIPTION_SYSTEM_PROMPT`, 120초 상한, **`blockage_kind == "분석"`일 때만 수행**, 실패는 삼키고 분석은 계속 |
| 9 | ffmpeg는 압축 한 곳, 폴백 3경로 | **호출이 셋**이고(`compress_for_gemini` 600초 / `clip_head`·`extract_audio` 120초) **락 하나를 공유**한다(`acting-llm/media.py:_FFMPEG_LOCK`). 압축 폴백은 **5경로**다 |
| 10 | (언급 없음) | **duration 판정에 ffprobe가 낀다**(`analysis_worker.py:_video_duration_ms`). 실패하면 `unsupported_media`로 **즉시 FAILED**다 — 재큐가 아니다 |
| 11 | 줄 수: agent engine 246 · prompt 192 · worker 258 | **138 · 1219 · 354.** 프롬프트가 6배가 됐다 — 이식 비용의 무게중심이 코드가 아니라 **프롬프트 문자열**에 있다 |

## 목적

`acting-summary`·`acting-agent`·`acting-report`·`acting-llm`과 분석 워커를 옮기고, M3에서 미뤄둔 LLM 의존 엔드포인트를 노출한다. **이 사이클이 끝나면 파이썬에 남는 기능이 없다.**

### A-0. 공급자 지형 (먼저 읽는다)

| 층 | 공급자 | 엔드포인트 | 호출부 |
|---|---|---|---|
| `acting-summary` — 영상 관찰 | **Gemini** | Files API 업로드 → `PROCESSING` 폴링 → `generate_content` | `acting-summary/summarizer.py:summarize` |
| `acting-agent` — 코치 | **OpenAI** | `POST https://api.openai.com/v1/responses` | `acting-agent/engine.py:_generate_validated` |
| `acting-report` — 리포트 | **OpenAI** | 같은 클라이언트 | `acting-report/engine.py:generate_report` |
| 음성 전사 | **OpenAI** | `POST /v1/audio/transcriptions` | `acting-llm/openai_client.py:transcribe_audio` |

**환경변수 이름을 유지한다**(`/SPEC.md` §5-6과 같은 이유 — M5에서 배포 문서·양쪽 서버 `api.env`를 건드리지 않기 위해). 기본값까지 같아야 한다:

| 변수 | 기본값 | 비고 |
|---|---|---|
| `OPENAI_API_KEY` | 없음 | **호출 시점에 `os.environ`에서 읽는다.** 부팅을 막지 않는다 — 키가 없어도 앱이 뜨고 코치를 시작하는 순간 실패한다. 이 지연 실패를 그대로 재현한다 |
| `OPENAI_CHAT_MODEL` | `gpt-5.6-terra` | `acting-llm/openai_client.py:_configuration` |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` | 같은 곳 |
| `GEMINI_API_KEY`·`GEMINI_MODEL` | — | 영상 관찰 전용 |

**OpenAI는 SDK를 쓰지 않는다.** 파이썬도 `httpx`로 REST를 직접 친다. Java도 `RestClient` 동형 이식이 기본안이며, 재시도 상수를 값까지 옮긴다:

- 시도 **4회**(`_ATTEMPTS`), 지수 백오프 **1→2→4초**, 재시도 대상은 **`{429, 503}`만**, 요청 타임아웃 **120초**
- 연결 오류(`httpx.RequestError`)는 마지막 시도에서만 전파된다
- 오류 메시지가 사용자에게 보인다 — 429·503은 "지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.", 그 밖은 "OpenAI가 HTTP {status}로 응답했습니다." (`acting-llm/openai_client.py:_api_error`)
- `generate_text`는 `(text, TokenUsage)`를 돌려준다. **토큰 사용량이 반환 계약의 일부**다. 응답에서 `output_text`를 우선 읽고, 없으면 `output[].content[]` 중 `type == "output_text"`를 이어붙인다. 최종 텍스트가 비면 `refusal`을 모아 메시지에 싣는다(`:_output_items`·`:_token_usage`)

**이 마일스톤의 성패는 코드량이 아니라 "생성 요청이 Python과 동일한가"이다.** 자연어 출력은 비결정적이므로, 완료 판정은 **요청 golden + 결정적 후처리**로 한다.

## 범위 — M3에서 넘어온 것 포함

| 엔드포인트 | 이유 | M3 완료분 |
|---|---|---|
| `POST /v2/coach/start` | OpenAI 호출 (`coaching.py:build_router.coach_start`) | 저장 계층(`coach/CoachSessionStore.java`)·낙관적 락 |
| `POST /v2/coach/reply` | 〃 (`.coach_reply`) | 〃 |
| **`POST /v2/coach/confirm`** | 리포트 생성 (`.coach_confirm`) | `coach/OwnedReportSource.java` |
| **`POST /v2/reports`** | 리포트 생성 (`reports.py:build_router.create_report`) | 저장 계층 완료. `GET` 둘은 M3에서 노출됨 |

**리포트 생성 진입점이 셋이다.** `coach_start`·`coach_reply`는 턴이 `complete`가 되면 그 자리에서 `_generate_completed_turn_report`를 부르고, `coach_confirm`·`create_report`는 `sync_operations.py:generate_source_report`를 부른다. 같은 `acting-report/engine.py:generate_report`로 모이지만 **인자를 만드는 경로가 다르다** — 한쪽만 맞추면 나머지가 조용히 어긋난다.

### `coach_start`의 LLM 없는 경로 — resume

`req.restart`가 false이고 열린 코치 세션이 있으면 **생성 호출 없이** 기존 대화를 돌려준다(`coaching.py:_resumed_coach_payload`, `SOMA-304`). 이식할 때 이 분기에서 생성 호출이 새지 않아야 한다.

주의: resume 분기 **안에도** `has_report_for_practice_session` 검사가 있어 리포트가 이미 있으면 409 `report already exists for practice session`이다. 순서가 뒤집히면 이미 끝난 세션이 되살아난다.

## 산출물

### A. `acting-summary` — 영상 관찰

`summarizer.py`(121) · `compress.py`(86) · `prompt.py`(104) · `schema.py`(24) · `store.py`(48) · `config.py`(33).

**생성 설정을 그대로 옮긴다** (`acting-summary/summarizer.py:summarize`):

```
system_instruction  = OBSERVATION_SYSTEM_PROMPT
response_mime_type  = "application/json"
response_schema     = ObservationPack
temperature         = 0.0
top_p               = 0.1
top_k               = 1
seed                = 42
media_resolution    = MEDIA_RESOLUTION_LOW
```

`media_resolution`은 비용 설정이다 — 영상 토큰을 초당 ~300→~100으로 줄인다(프레임당 258→64). 빠뜨리면 **비용이 3배가 된다.**

- **`contents=[uploaded, prompt]` 순서**를 지킨다. 프롬프트는 `acting-summary/prompt.py:buildObservationPrompt`가 `ActorMaterial`(상황·인물·목표·막힘 종류·막힘 상세·길이)로 만든다
- **파싱 실패 시 재시도 2회**(`for _ in range(2)`). 최종 실패는 `SummaryParseError`
- 파싱은 `response.parsed` 우선, 없으면 `response.text` JSON 파싱 (`:_parse`)
- **Files API** — 업로드 → `PROCESSING` 폴링(기본 **300초** 타임아웃 · **2초** 간격) → ACTIVE 아니면 `FileActiveTimeout` → 분석 → delete (`:_wait_active`)
- **`files.delete`는 best-effort** — `finally` 안의 `try`로 감싼다. Java에서 예외를 전파하면 **성공한 분석이 실패로 뒤집힌다**
- **후처리는 `:_filter_observations` 하나다** — `start_ms >= 0`, `end_ms > start_ms`, `end_ms <= duration_ms`를 통과한 관찰만 남기고 **앞에서 3개로 자른다**. 관찰 0개도 정상이다
- 🔎 **응답 캐시**(`:_cache_path`) — `cache_dir`이 주어지면 sha256(영상 바이트 ‖ `OBSERVATION_SYSTEM_PROMPT` ‖ 프롬프트 ‖ 모델명)으로 파일을 찾아 있으면 LLM을 부르지 않고, 없으면 결과를 쓴다. **캐시 히트에도 `_filter_observations`를 다시 통과시킨다**(`duration_ms`가 달라질 수 있어서). 해시 재료와 순서가 계약이다
- **ffmpeg 압축** (`acting-summary/compress.py:compress_for_gemini`) — 파라미터를 값까지 옮긴다: `-threads 1`(두 번 나온다) · `scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2` · `-r 10` · `libx264` · `-preset ultrafast` · `-crf 28` · `-pix_fmt yuv420p` · `aac 64k` · `-ac 1` · `+faststart`. 타임아웃 **600초**
  - **폴백 5경로** — ①`<= 15MB`(`MIN_BYTES`) ②ffmpeg 부재 ③실행 실패·타임아웃(산출물 삭제) ④산출물이 없거나 0바이트 ⑤**산출물이 원본보다 크거나 같음**. 다섯 모두 원본 경로를 그대로 돌려준다
  - 압축본을 쓴 경우 **호출자가 지운다**(`analysis_worker.py:SummaryAnalyzer.analyze`의 `finally`)

### B. `acting-agent` — 코치

`engine.py`(138) · **`prompt.py`(1219)** · `schema.py`(50) · `store.py`(80) · `summary_schema.py`(30) · `config.py`(15).

**프롬프트가 이 산출물의 대부분이다.** 1219줄을 한 글자도 바꾸지 않고 옮긴다 — 공백·줄바꿈·한글 조사까지. 분기는 `acting-agent/prompt.py:select_prompt`가 `blockage_kind`로 고른다.

생성 호출은 평문이다 — `generate(system_prompt, build_chat_prompt(session, user_message))` 하나뿐이고 **temperature·schema를 지정하지 않는다**(`:_generate_validated`).

**폴백 사슬을 순서대로 재현한다:**

1. `parse_coaching_response` — 앞뒤 ` ```json ` 펜스를 정규식으로 벗긴다(대소문자 무시). JSON이 아니거나 `message`가 문자열이 아니면 **원문 전체를 message로 삼고** `status="continue"`·`handoff=null`
2. `status == "complete"`이고 `handoff`가 **dict일 때만** complete로 인정한다. 둘 중 하나라도 아니면 continue로 강등되고 handoff는 버려진다
3. `acting-llm/validate.py:validate_turn`(문장 수 제한은 끈다) 실패 시 → `build_regeneration_prompt`로 **재생성 1회**
4. 재생성도 실패하면 `safe_template()` 안전 문장 + `status="continue"`

**마무리 요청 감지** — `reply`는 배우 텍스트에 `"그만"`·`"종료"`·`"끝"` 중 하나라도 **포함**되면 `_CLOSING_TURN_INSTRUCTION`을 사용자 메시지 **뒤에 이어붙인다**(`:_CLOSING_WORDS`). 저장되는 턴 텍스트는 **붙이기 전의 원문**이다 — 지시문이 대화 기록에 남으면 안 된다.

**턴 적재 순서** — `start`는 `actor`(= `blockage_detail` 또는 `goal`) → `ai`, `reply`는 `actor` → `ai`. 생성 **후에** 추가하므로 프롬프트에는 직전 턴까지만 들어간다.

- **`SessionWriteConflict` → 409 `session changed concurrently`** (`coaching.py:build_router.coach_reply`). 낙관적 락은 M3의 `coach/CoachSessionStore.java`를 쓴다

### C. `acting-report` — 리포트

`engine.py`(167) · `prompt.py`(382) · `schema.py`(85) · `summary_schema.py`(15) · `config.py`(15).

- 프롬프트는 둘 — `REPORT_ANALYSIS_PROMPT`·`REPORT_EXPRESSION_PROMPT`
- **입력 JSON을 만드는 규칙이 계약이다**(`:build_report_input`). `json.dumps(..., ensure_ascii=False, indent=2)`로 직렬화해 보낸다 — **들여쓰기 2칸·한글 raw**가 프롬프트의 일부다
  - `analysis`: `{video_summary, confirmed_handoff, confirmation}`
  - `expression`: 위에 `analysis_handoff`·`expression_handoff`가 더해진다
  - `video_summary`는 `ObservationPack`으로 검증한 뒤 `model_dump(mode="json")`한 것이다
- **차단 경로**(LLM을 부르지 않는다) — `confirmed`가 false거나 handoff가 없으면, 또는 expression인데 `:_expression_ready`가 false면 `BlockedReport`를 즉시 돌려준다. 사유 문자열이 갈린다: `confirmed_analysis_handoff_required` / `confirmed_expression_handoff_required`
  - `_expression_ready`는 `experiment.tested is True` **그리고** `experiment.instruction`이 비지 않은 문자열 **그리고** `observed_change`가 비지 않은 문자열일 때만 참이다
- 파싱(`:_parse_report`) — 펜스 벗기기 → dict 아니면 `ReportParseError` → `report_type == "blocked"`면 `BlockedReport` → analysis면 `source_handoff_id`를 **주입해서** 검증 → expression이면 `source_handoff_ids = {analysis, expression}`를 **주입해서** 검증. 검증 실패는 `ReportParseError`
- **`ReportParseError` → 502**, 그리고 sync operation을 `report_parse_error`로 실패시킨다. 네 진입점 모두 같다

### D. 분석 워커

`analysis_worker.py`(354) → `@Scheduled` + `ThreadPoolTaskExecutor`.

**lease 상태 전이는 `/SPEC.md` §5-7의 표를 그대로 구현한다.** 특히:
- lease 만료됐어도 재선점 전이면 **완료 허용**
- `release`는 **`attempt_count`를 되돌리지 않는다**
- **오류 분류가 전이를 가른다**(`:analysis_error_code`) — `FileActiveTimeout`·`TimeoutError` → `gemini_timeout`, `SummaryParseError` → `gemini_parse_error`, `UnsupportedMediaError` → `unsupported_media`. **이 셋만 즉시 `FAILED`**이고 나머지(S3·ETag 불일치·그 밖 전부)는 `None`을 돌려받아 **`PENDING` 재큐** → 3회 소비 후 sweep이 `FAILED`
- `LeaseOwnershipError`는 **아무것도 하지 않고 로그만 남긴다** — 실패 처리도 하지 않는다

`run_once` 골격:
1. `claim_next_external_operation(kind="analyze")` — 없으면 **false 반환**(하네스의 `processed: 0`)
2. 컨텍스트 없음 → `unsupported_media`로 fail, **true 반환**
3. `mime_type`이 `video/`로 시작하지 않음 → `unsupported_media`로 fail
4. 임시 파일 확장자는 **object key의 suffix, 없으면 `.video`**
5. 다운로드 → **ETag 대조** → 불일치면 `ObjectETagMismatchError`(→ 재큐)
6. `SummaryAnalyzer.analyze` → 완료 전이
7. `finally`에서 임시 파일 삭제

**`SummaryAnalyzer.analyze` 순서가 계약이다**: duration 확정 → 압축 → **관찰 생성** → **전사** → 결과 조립. 전사가 관찰 뒤에 온다.

🔎 **음성 전사** (`:SummaryAnalyzer._transcribe`) — 2차 개정본에 통째로 빠져 있던 층이다.
- **`blockage_kind != "분석"`이면 건너뛴다.** 한글 리터럴이 분기 조건이다
- `acting-llm/media.py:extract_audio`로 앞 **120초**(`TRANSCRIPTION_MAX_DURATION_MS`)를 mp3(`libmp3lame -q:a 4`)로 뽑아 `transcribe_audio`에 넘긴다. 시스템 프롬프트는 `TRANSCRIPTION_SYSTEM_PROMPT`(한국어 4개 규칙) 원문 그대로
- **모든 예외를 삼킨다** — `logger.warning("transcription failed; continuing analysis")`만 남기고 빈 튜플을 돌려준다. 대사 없는 분석이 정상 완료된다
- `finally`에서 임시 디렉토리를 통째로 지운다(`shutil.rmtree(parent)`)
- 후처리 `:transcript_segments_from_text` — CRLF/CR을 LF로 정규화 → 줄 단위 분할 → 각 줄을 **문장부호 `.!?。！？` 뒤 공백**에서 다시 분할 → strip 후 빈 줄 제거. **결정적이므로 golden 대상이다**

🔎 **duration 판정** (`:_video_duration_ms`) — declared 값이 있고 0보다 크면 그것을 쓰고, 없으면 **ffprobe**(`-show_entries format=duration`, 30초 타임아웃)로 구해 **반올림**(`round`)한다. ffprobe 부재·실패·0 이하는 전부 `UnsupportedMediaError` → **즉시 FAILED**다.

`sweep()`은 `(만료 업로드 수, 소진 operation 수)`를 돌려준다. 객체 삭제는 현재 `DeleteObject` 권한이 없어 조용히 실패 중이다 — **현행 동작을 그대로 재현한다**(예외를 삼키고 warning).

`AnalysisWorkerPool` — concurrency만큼 데몬 스레드, poll **2초**, sweep **60초**, **인덱스 0 스레드만 sweep**. 일감이 없을 때만 대기한다.

그 밖에:
- **외부 호출을 트랜잭션 안에 넣지 않는다** (`/SPEC.md` §5-4-1)
- **`run_once()` 동기 훅을 반드시 제공한다** — 하네스가 워커를 결정론적으로 구동하는 유일한 수단(M1)
- **`ANALYSIS_WORKER_ENABLED` 스위치를 제공한다** — M5에서 두 백엔드가 같은 큐를 소비하지 않도록 owner를 하나로 고정하는 데 필요하다

### E. keepalive

`keepalive.py:keep_alive_loop` — `KEEP_ALIVE_URL`이 있을 때만 주기 핑. **URL 뒤에 `/health`를 붙이고**(끝 `/`는 제거) 실패는 warning으로 삼킨다. **첫 핑 전에 먼저 잔다**(sleep → get 순서). `/health`의 `keep_alive`가 이 설정 여부를 반영한다.

### F. M3가 넘긴 셋 — 이 사이클에서 닫는다

`spec/M3-findings.md`「남은 것」의 세 항목이다. 각각의 근거는 그 문서에 있고, 여기서는 **M4의 산출물로서** 규정한다.

#### F-1. lease 전이표의 나머지 — 워커보다 **먼저** 만든다

`operation/ExternalOperationClaimer.java`에는 claim-next 하나뿐이다. `/SPEC.md` §5-7의 다섯 상황 중 claim-by-id·fail·release·max-attempts sweep의 Java 대응물이 없다.

**순서를 지킨다** — 워커를 만들기 전에 저장 계층을 세우고 **§5-7 다섯 행을 각각 Testcontainers로 고정한다.** `release`가 `attempt_count`를 되돌리지 않는 것과 3회 소비 후 sweep이 `FAILED`로 넘기는 것은 **응답에 드러나지 않아** 하네스가 잡지 못한다.

#### F-2. 요청 검증을 캐시된 JSON 트리 기반으로 — **한 덩어리로 다룬다**

M3 Phase 5·6 리뷰가 같은 뿌리에서 나온 지적 넷을 냈다. 개별로 고치면 부분해가 되고 서로를 무효화한다.

1. **422가 오류를 하나만 담는다.** pydantic은 필드 오류를 전부 모으는데 Java는 순차 검증이라 첫 건에서 멈춘다. 빈 title+body는 원본이 **2건**을 낸다(실측). `community.py:PostWriteRequest`, `practice_sessions.py`의 literal 두 필드, community 신고의 `target_type`·`reason`이 해당한다
2. **명시적 `null`과 생략을 구분하지 못한다.** `anonymous`가 primitive `boolean`이라 Jackson이 `null`을 `false`로 바꾼다 — 원본은 `bool_type` 422다(실측). `@NotNull` 위반을 전부 `missing`으로 분류하는 것도 같은 문제로, 원본은 명시적 null에 `string_type`을 낸다
3. **`literal_error`를 `enum`으로 낸다.** 판별자 자체가 다르다
4. **게이트가 바디 검증보다 늦게 돈다.** Spring은 `@Valid @RequestBody`를 메서드 진입 전에 평가하는데 FastAPI는 `Depends`를 먼저 푼다. 미동의·미인증·레이트리밋 상태에서 잘못된 바디를 보내면 Java 422 · Python 403/401/429로 갈린다

**넷은 요청 바디를 DTO로 바인딩하기 전에** 캐시된 JSON 트리를 순회하며 "존재 여부·타입·누적"을 판정하고, 라우트별 인증·레이트리밋·동의 정책을 그 앞에 두는 구조라야 한꺼번에 풀린다. `web/RequestBodyCachingFilter.java`가 이미 원본 바디를 들고 있어 토대는 있다.

**M4에서 하는 이유**: M4는 어차피 coach·reports 라우트를 새로 열어 422 경로를 다시 건드린다. 새 라우트를 낡은 검증 구조로 만들고 나서 고치면 두 번 일한다. **새 라우트를 열기 전에 이 구조를 먼저 바꾼다.**

#### F-3. `/v2/admin/stats` 지표 확장 흡수

`c8ce457`이 `admin.py:AdminStats`를 크게 늘렸다. Java는 M3 시점 형상(**26필드**)이고 원본은 **55필드 + 중첩 모델 둘**이다(`admin.py:AdminFunnelStep`·`admin.py:AdminCloseReasonCount`).

빠진 것: `users_yesterday`·`active_users_yesterday`(각 `_real` 포함) · `funnel_steps` · `close_reasons` · `gap_stated_24h/7d/all`(각 `_real`) · `db_size`(nullable 문자열) · `observations_total` · `observations_per_summary`(**float**) · `last_signup_at`·`last_session_at`(nullable datetime).

🔎 **판정 방법을 함께 만든다.** admin 2개는 `ADMIN_OPS_TOKEN`이 있을 때만 등록돼 committed `openapi.json`에 **아예 없다**(`/SPEC.md` §6-2). 그래서 openapi diff도 `AdminEndpointIT`도 **낡은 채로 초록**이다. admin 프로파일 inventory를 committed 스펙이 아니라 **파이썬 소스에서** 생성해 필드 단위로 대조하는 검사를 세운다.

다만 하네스는 이 경로를 덮을 수 있다 — `tools/contract-harness/contract_harness/config.py:ADMIN_OPS_TOKEN`이 고정값으로 있어 **양쪽 백엔드 모두 admin 라우터가 등록된 채로 뜬다.** M3에서 `admin` 시나리오가 못 돈 이유는 토큰이 아니라 `/v2/coach/start` 미존재였고, 그것이 M4에서 열린다. **`admin` 시나리오 diff 0을 F-3의 관문으로 삼는다.**

## 검증 — 관문은 golden, smoke는 참고

**실 LLM 호출의 "구조 동등성"만으로는 생성 설정 차이를 검출할 수 없다.** `temperature`나 `seed`가 빠져도 스키마는 여전히 맞는다. 따라서 관문을 나눈다.

### 관문 ① 요청 golden test (필수)

나가는 요청 전체를 캡처해 Python과 비교한다. 실호출 없이 스텁으로 한다.

- **Gemini**: 생성 설정 전 필드(temperature·top_p·top_k·seed·media_resolution·response_mime_type·response_schema) + `contents` 배열의 **순서와 내용** + `system_instruction` + 모델명
- **OpenAI**: 요청 바디 `{model, instructions, input}` 세 필드. `input`은 **직렬화된 문자열까지** 비교한다 — 리포트는 `indent=2`·`ensure_ascii=False`가, 코치는 `build_chat_prompt` 출력이 그 자리에 온다
- **전사**: multipart 필드(`model`·`response_format=json`·`prompt`)와 파일 파트 이름(`audio.mp3`·`audio/mpeg`)

### 관문 ② 결정적 후처리 test (필수)

같은 LLM 응답을 넣었을 때 다음이 **완전히 일치**해야 한다.

- `_filter_observations` — 경계값(`start_ms == 0`, `end_ms == duration_ms`, `end_ms == start_ms`)과 **4개 이상일 때 앞 3개 절단**
- `parse_coaching_response` — 펜스 있음/없음, JSON 아님(원문 통과), `message` 비문자열, `complete`인데 handoff가 dict 아님(→ continue 강등)
- `transcript_segments_from_text` — CRLF·연속 개행·문장부호 분할·전각 문장부호
- `build_report_input`·`_expression_ready` — 차단 경로 두 사유 문자열
- `_parse_report` — handoff id 주입 형상(analysis는 `source_handoff_id`, expression은 `source_handoff_ids` dict)

### 관문 ③ production-envelope 스파이크 (**Phase 3 착수 전** 필수)

**M0의 Gemini PASS는 6초·80KB 영상 1건이다.** SDK에 세 API가 존재한다는 것만 보였고 실제 부하·실패 경로는 건드리지 않았다. **SDK 채택은 잠정 결정이며 아래를 통과해야 확정된다:**

- 예상 최대 크기의 post-compression 파일 업로드
- **압축 실패 시의 원본**(15MB 초과) 업로드 — SDK의 다중 chunk 경로가 열린다
- JSON 파싱 첫 실패 후 재시도 성공 / 2회 모두 실패
- **`files.delete` 예외 주입** → 분석 성공 결과가 뒤집히지 않는지
- 워커 lease 3회 시도 예산 소진 경로

여기서 막히면 raw REST 경로로 전환한다. M0는 그 가능성을 배제하지 못했다.

### 참고 ④ 실 LLM smoke (비결정적)

소수 케이스로 실제 호출해 스키마 준수·필드 존재·enum 범위를 본다. **완료를 막는 관문으로 쓰지 않는다.** 비용이 들므로 케이스를 고정한다.

## 완료 기준 체크리스트

- [ ] `POST /v2/coach/start`·`/reply`·**`/confirm`**, `POST /v2/reports` 노출. 409 `session changed concurrently` 재현
- [ ] **resume 분기에서 생성 호출이 나가지 않는다.** 그 안의 `report already exists for practice session` 409도 재현
- [ ] **요청 golden**: Gemini 생성 설정 전 필드 + contents 순서 + system_instruction + 모델명, OpenAI 세 필드 + 직렬화된 input 문자열
- [ ] summary의 `media_resolution=LOW`가 실제로 실려 나간다 (비용 3배 방지)
- [ ] 파싱 실패 시 **재시도 2회**, 최종 실패는 `SummaryParseError` 상당
- [ ] **`files.delete` 실패가 분석 성공을 뒤집지 않는다**
- [ ] **응답 캐시** — 해시 재료 4개와 순서, 캐시 히트 시 LLM 미호출, 히트에도 필터 재적용
- [ ] 코치 **폴백 사슬 4단**(펜스 → 원문 통과 → 재생성 1회 → 안전 문장)과 complete 강등 규칙
- [ ] 마무리 요청 3단어 감지, **저장 턴에는 지시문이 붙지 않는다**
- [ ] 리포트 **차단 경로 두 사유 문자열**과 `_expression_ready` 세 조건
- [ ] `ReportParseError` → **502** + `report_parse_error` 실패 전이 (네 진입점 모두)
- [ ] ffmpeg 3호출: 파라미터 동일, **락 하나 공유**, 타임아웃 600/120/120초, 압축 **폴백 5경로**
- [ ] ffprobe duration 판정과 **`unsupported_media` 즉시 FAILED**
- [ ] **음성 전사**: `blockage_kind == "분석"` 조건, 120초 상한, 실패 삼킴, `transcript_segments_from_text` 일치
- [ ] Files API 업로드·폴링(300초/2초)·삭제. 타임아웃 시 `FileActiveTimeout` 상당
- [ ] OpenAI 재시도 상수 4회·1→2→4초·`{429,503}`·120초, **오류 메시지 문자열 두 종**
- [ ] 워커: **`/SPEC.md` §5-7 전이표 5행 각각을 Testcontainers로 테스트** (F-1, 워커보다 먼저)
- [ ] **`run_once()` 동기 훅** 제공
- [ ] **`ANALYSIS_WORKER_ENABLED` 스위치** 제공
- [ ] **F-2 요청 검증 구조 전환** — 422 다건 누적 · 명시적 null 구분 · `literal_error` 판별자 · 게이트가 바디 검증보다 먼저. **새 라우트를 열기 전에 끝낸다**
- [ ] **F-3 admin stats 55필드 + 중첩 모델 둘**, 그리고 **소스 기반 inventory 대조 검사**
- [ ] 🔎 **제어 표면의 나머지 셋을 채운다** — `run-worker-once`·`run-sweep`·`stub-state`. 🔁 2차 개정본은 "5개"라 적었지만 `tools/contract-harness/contract_harness/config.py:CONTROL_SURFACE`는 **6개**이고, M3가 `advance-clock`·`db-projection`·`reset-state` 셋을 이미 채웠다(`harness/HarnessController.java`). **transport 형태는 Python 하네스 어댑터와 동일해야 한다**
  - **M1이 확정한 transport**: `POST /__harness/<name>`, 요청·응답 모두 JSON. 요청 바디는 `advance-clock`이 `{"seconds": N}`, `db-projection`이 `{"include": [...]}`, 나머지는 `{}`다. 응답 키는 `run-worker-once` → `{"processed": n}`, `run-sweep` → `{"expired_uploads": n, "exhausted_operations": n}`, `advance-clock` → `{"offset_sec": n}`, `stub-state`·`db-projection`은 `tools/contract-harness/contract_harness/wrapper.py:BackendRuntime.control`·`.db_projection`의 형상을 그대로 따른다
  - **외부 의존 스텁의 값은 `tools/contract-harness/contract_harness/fixtures/`에서 읽는다**(`llm.json`·`s3.json`·`auth_providers.json`). 언어가 달라도 같은 파일을 읽으면 같은 값이 나온다. **`llm.json`에는 사양이 몰랐던 계약이 셋 있다:**
    - **`budget`** — coach 24회·report 12회. 스텁 호출 예산이며 초과 시의 동작이 시나리오 판정에 쓰인다
    - **`$` 참조** — `by_marker["[[coach:complete]]"].handoff`의 값이 문자열 `"$analysis_handoff"`다. 최상위 `analysis_handoff` 객체로 **치환해서** 돌려줘야 한다
    - **마커는 프롬프트 전체에서 찾는다.** `[[report:parse_error]]`는 coach 응답의 `coach_summary` 안에 실려 리포트 프롬프트로 전파되고, 그때 스텁이 **JSON이 아닌 문자열**을 돌려줘 `ReportParseError` → 502 경로를 연다. 즉 스텁은 자기 층의 마커만 보는 게 아니다
- [ ] 🔎 **LLM 스텁 게이트**: 프롬프트에 `[[stub:block]]`이 있으면 스텁이 신호가 올 때까지 멈춘다. 클레임을 잡은 뒤 LLM을 부르는 구조라, 이 게이트가 **sync operation이 running인 구간**을 결정적으로 만드는 유일한 훅이다(409 `request is still processing` 다섯 지점의 근거). 해제·재무장은 `stub-state`의 payload(`{"release": true}` / `{"rearm": true}`)로 하고, `stub-state` 응답에 `blocked`·`in_block`·`timed_out`을 싣는다. 게이트에는 상한 시간을 둬 신호를 못 받아도 매달리지 않는다
- [ ] 🔎 **M1에서 java 대상이라 못 돌린 검증이 여기서는 돌아야 한다.** 하네스 쪽 배선은 이미 되어 있으므로 남은 것은 java 쪽 조건뿐이다
  - **seed parity** — 하네스가 java contract 프로파일의 스키마 이름을 알아야 두 스키마 시드 지문을 대조할 수 있다. 지금은 "스키마 이름을 모른다"는 사유로 건너뛴다
  - **오류 계약 manifest·unknown key·레이트리밋 오염 검사** — 해당 시나리오가 java에서 실제로 돌아야 판정이 생긴다
  - **openapi 전 문서 semantic 비교** — `--only` 없이 돌리면 커밋된 계약 전체와 비교한다. M3는 M3 inventory slice로 판정했다
- [ ] 🔎 **contract 프로파일의 DB 스키마 이름을 하네스가 알 수 있어야 한다** — `tools/contract-harness/contract_harness/dbops.py`의 이름 붙은 조작이 대상 스키마에 직접 붙는다
- [ ] 🔎 **contract 프로파일에서 백그라운드 워커가 뜨지 않는다.** 시간 의존 동작은 `advance-clock`으로만 일어난다
- [ ] 🔎 **제어 표면이 운영 프로파일에 노출되지 않는다** — loopback 전용이며 기본 프로파일에서 라우트가 등록되지 않음을 테스트로 단언
- [ ] `auth/FixedWindowRateLimiter.java`의 `advanceContractClock()`·`reset()`을 contract 프로파일로 가르거나 가시성을 좁힌다 (M3 잔여)
- [ ] 외부 호출이 트랜잭션 밖에 있다 (커넥션 점유 시간으로 확인)
- [ ] **M1 하네스 전량 통과** — 여기서 처음으로 전 시나리오가 관문이 된다
- [ ] `openapi.json` **전체** diff 0 (datetime 통일 제외)
- [ ] 실 LLM smoke 통과 (참고 지표)
- [ ] **파이썬 기능 잔여 0** — 이식되지 않은 기능 목록이 비어 있음을 확인

## 하지 말 것

1. **프롬프트 문구를 개선하지 않는다.** 한 글자도 바꾸지 않는다. `acting-agent/prompt.py`만 1219줄이다
2. **생성 설정을 "정리"하지 않는다.** `seed=42`·`top_k=1`은 결정성 확보용이고 `media_resolution`은 비용 설정이다
3. **후처리 로직을 정리하지 않는다.** 관찰 상한 3개·문장 분할 규칙·강등 규칙은 계약이다
4. **`files.delete` 실패를 예외로 올리지 않는다**
5. **전사 실패를 예외로 올리지 않는다.** 대사 없는 분석이 정상 완료되는 것이 현행이다
6. **폴백을 "더 안전하게" 만들지 않는다.** 원문 통과·안전 문장은 사용자에게 보이는 동작이다
7. `DeleteObject` 권한 문제를 고치지 않는다 — 현행 동작 재현
8. 기존 `apps/api` 수정 금지
9. 스코프 밖 리팩터링 일체
