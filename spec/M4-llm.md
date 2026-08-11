# M4 — LLM 파이프라인

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M4 사이클에만 적용된다.**

- BASE_REF: `4ef7cab` (2026-08-09 **5차 개정**)
  - **3차** — `6102ef8`「AI 3개 층을 관찰 팩·질문 대화·연습 카드로 교체한다」를 반영해 사실 오류 11건을 고쳤다. 2차 개정(`8fdca45`)은 그 커밋 **이전** 시점이었다
  - **4차**(`2d0e12a` 기준) — Codex 적대적 비판이 낸 지적 10건을 전부 소스로 재검증해 반영했다. **그중 셋은 3차 개정 자신의 오류**였다
  - **5차** — `/SPEC.md` §12 진입 점검 4단계를 **실제로 돌려** 고쳤다. dev 전진분(`SOMA-326` Sentry)을 흡수하고, §G를 구현하면서 그 규모가 4차 개정이 쓴 것보다 훨씬 작다는 것을 확인했다

> ⚠ **이 문서는 두 번 틀렸고, 두 번째 수정도 부분적으로 틀렸다.** 3차 개정은 2차의 오류 11건을 고쳤지만 스스로 셋을 새로 만들었다 — 재시도 횟수를 하나 많게 적었고, ffmpeg 호출 수를 과장했으며, 비활성 유틸리티(응답 캐시)를 운영 계약으로 격상시켰다. `/SPEC.md` §12가 말하는 "적어 두고 실행한 적 없는 것"은 **문서를 고치는 작업 자체에도 적용된다.** 이 문서의 단정적인 문장을 만나면 소스를 열어라.
>
> 🔧 **5차 개정은 그 반대 방향의 오류도 하나 찾았다** — 4차 개정의 §G는 실재하는 결함을 정확히 짚었지만 **작업량을 과대평가**했다. 사양이 "이것이 없으면 전량 통과가 불가능하다"고 쓴 항목의 실제 diff는 시나리오 3곳이었다. 위험을 과장하는 것도 드리프트다.

## 3차 개정이 고친 것 — 2차 개정본이 틀렸던 자리

| # | 2차 개정본이 적었던 것 | 실제 |
|---|---|---|
| 1 | 이식 대상은 `engine.py`·`targeting.py`·`guard.py`·`prompt.py`·`clip.py`·`knowledge.py` | **넷이 존재하지 않는다.** `6102ef8`이 질문 은행과 코드 타깃 선정을 걷어냈다. 🔁 단, `guard.py`의 검증 책임은 **`acting-llm/forbidden.py`·`acting-llm/validate.py`로 되살아났다**(§B) |
| 2 | summary의 `response_schema = SceneSummary` | **`ObservationPack`**이다 (`acting-summary/schema.py:ObservationPack`) |
| 3 | 후처리 `_finalize` — severity 계산(`_IMPACT_POINTS` + key score), anomaly 정렬, **`_AXIS_ORDER` 한글 6축** | **전부 존재하지 않는다.** 실제 후처리는 `acting-summary/summarizer.py:_filter_observations` 하나 — 구간 유효성 검사 + **상한 3개 절단**이다. (`db/models.py:Anomaly`의 `severity`·`sort_order` 컬럼은 스키마 보존용으로 남아 있을 뿐 신규 저장이 행을 만들지 않는다) |
| 4 | (언급 없음) | 응답 캐시가 있다 (`acting-summary/summarizer.py:_cache_path`). 🔁 **다만 운영 경로에서는 열리지 않는다** — 4차 개정 참조 |
| 5 | agent는 `response_mime_type` + `response_schema`로 구조화 출력을 받는다 | **평문 호출이다.** OpenAI `POST /v1/responses`에 `{model, instructions, input}` 셋만 보낸다 |
| 6 | **형제 스키마 파싱 폴백** — `close` 유무만 다른 모델로 파싱돼 오면 필드를 옮겨 담는다 | **존재하지 않는다.** 실제 폴백 사슬은 ①펜스 벗기기 ②원문을 message로 ③재생성 1회 ④안전 문장이다 |
| 7 | 범위는 `/v2/coach/start`·`/v2/coach/reply`·`POST /v2/reports` 셋 | **`POST /v2/coach/confirm`이 빠져 있었다**(`coaching.py:build_router.coach_confirm`). 리포트 생성은 넷 **전부**에서 일어난다 |
| 8 | (언급 없음) | **음성 전사 층이 통째로 새로 생겼다** (`analysis_worker.py:TRANSCRIPTION_SYSTEM_PROMPT`) |
| 9 | ffmpeg는 압축 한 곳, 폴백 3경로 | 압축 폴백은 **5경로**다. ffmpeg 실행 함수는 셋이고 락 하나를 공유한다. 🔁 **다만 운영 call graph는 둘** — 4차 개정 참조 |
| 10 | (언급 없음) | **duration 판정에 ffprobe가 낀다**(`analysis_worker.py:_video_duration_ms`). 실패는 `unsupported_media`로 **즉시 FAILED** |
| 11 | 줄 수: agent engine 246 · prompt 192 · worker 258 | **138 · 1219 · 354.** 이식 비용의 무게중심이 코드가 아니라 **프롬프트 문자열**에 있다 |

## 4차 개정이 고친 것 — 3차 개정본이 틀렸거나 못 본 자리

Codex 적대적 비판이 냈고, 전부 소스로 재검증해 **10건 모두 수용**했다. 기각한 지적은 없다.

| # | 3차 개정본 | 실제 | 심각도 |
|---|---|---|---|
| A | "파싱 실패 시 **재시도 2회**" | `for _ in range(2)`는 **총 2회 호출 = 재시도 1회**다. 예외 문구도 `"failed to parse after retry"` 단수다. 2차 개정본의 문언을 검증 없이 옮긴 것 | high |
| B | "ffmpeg **호출이 셋**" | 정의는 셋이지만 **`acting-llm/media.py:clip_head`는 호출자가 없다.** 운영 call graph는 압축·음성추출 **둘** | medium |
| C | 응답 캐시의 "해시 재료와 순서가 계약이다" | `cache_dir`을 넘기는 호출자가 **테스트뿐**이다. 운영 워커는 넘기지 않아 캐시가 열리지 않는다. 비활성 유틸리티를 계약으로 격상시킨 것 | medium |
| D | "하네스 배선은 이미 되어 있다" | **게이트 시나리오가 Java에서 실행되지 않는다.** §G 신설 | high |
| E | `acting-llm/validate.py:validate_turn`을 이름만 언급 | 금지어 목록·NFKC·시간코드 정규식 5개가 재생성 여부를 가르고, **실패 메시지 한국어 문자열이 재생성 프롬프트에 들어간다** | high |
| F | §5-7 다섯 행 + "claim-by-id·claim-next" | **두 claim의 eligibility가 다르다** — by-id는 `FAILED && lease_token is null`도 재선점하고 claim-next는 FAILED를 제외한다. lease도 sync 15분 / worker 1800초로 다르다 | high |
| G | `ReportParseError` → 502만 규정 | **confirm의 상태 변경이 리포트 생성 실패보다 먼저 커밋된다.** 502 뒤에도 확인·세션 닫힘이 남는다 | high |
| H | resume 분기만 "LLM 미호출"로 규정 | **`create_report`·`coach_confirm`도 기존 리포트가 있으면 LLM을 건너뛴다** | medium |
| I | `GEMINI_API_KEY`·`GEMINI_MODEL` 기본값을 `—`로 표기 | `GEMINI_MODEL` 기본값은 **`gemini-2.5-flash`**이고, `GEMINI_API_KEY`가 없으면 **부팅이 실패한다**(OpenAI의 지연 실패와 반대) | medium |
| J | 축약 참조(`:_parse` 등)를 다수 사용 | `spec/check-refs.py:SYMBOL_REF`는 **완전한 `파일.py:심볼`만** 인식한다. 이번 개정을 낳은 것과 같은 구멍을 다시 남긴 것 → 4차에서 전부 완전형으로 교체 | medium |

## 목적

`acting-summary`·`acting-agent`·`acting-report`·`acting-llm`과 분석 워커를 옮기고, M3에서 미뤄둔 LLM 의존 엔드포인트를 노출한다. **이 사이클이 끝나면 파이썬에 남는 기능이 없다**(단 `observability.py`는 M5로 이월 — §A-0).

### 착수 순서 — 뒤집으면 두 번 일한다

0. ✅ **관문 ③ production-envelope 스파이크** — SDK 채택 확정. 여기서 막혔다면 §A가 raw REST로 바뀌었다
1. ✅ **§G 하네스 게이트 추상화** — 없으면 "전량 통과"가 원리적으로 불가능하다. **선행 완료**(`89b728f`)
2. **§F-2 요청 검증 구조 전환** — 새 라우트를 **열기 전에** 끝낸다. 나중에 하면 coach·reports의 422 경로를 두 번 만든다
3. **§F-1 lease 저장 계층** — 워커보다 **먼저** 세우고 두 claim의 갈래를 Testcontainers로 고정한다
4. **§A~§D LLM 층과 워커** — 그 위에 얹는다
5. **§G-2 · §F-3** — Java 타겟 게이트 시나리오 완주와 admin 대조는 위가 다 선 뒤에만 판정된다

Phase 3은 **Codex 단독**이다(`/SPEC.md` §11, 2026-08-09 사용자 결정).

### A-0. 공급자 지형 (먼저 읽는다)

| 층 | 공급자 | 엔드포인트 | 호출부 |
|---|---|---|---|
| `acting-summary` — 영상 관찰 | **Gemini** | Files API 업로드 → `PROCESSING` 폴링 → `generate_content` | `acting-summary/summarizer.py:summarize` |
| `acting-agent` — 코치 | **OpenAI** | `POST https://api.openai.com/v1/responses` | `acting-agent/engine.py:_generate_validated` |
| `acting-report` — 리포트 | **OpenAI** | 같은 클라이언트 | `acting-report/engine.py:generate_report` |
| 음성 전사 | **OpenAI** | `POST /v1/audio/transcriptions` | `acting-llm/openai_client.py:transcribe_audio` |

**환경변수 이름과 기본값을 유지한다**(`/SPEC.md` §5-6과 같은 이유 — M5에서 배포 문서·양쪽 서버 `api.env`를 건드리지 않기 위해).

| 변수 | 기본값 | 없을 때 |
|---|---|---|
| `OPENAI_API_KEY` | 없음 | **부팅은 된다.** `acting-llm/openai_client.py:_required_configuration`이 호출 시점에 `os.environ`을 읽어 `RuntimeError`를 던진다 — 로그인·업로드·분석까지 통과한 뒤 **코치를 시작하는 순간** 실패한다. 이 지연 실패를 그대로 재현한다 |
| `OPENAI_CHAT_MODEL` | `gpt-5.6-terra` | — |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-transcribe` | — |
| **`GEMINI_API_KEY`** | 없음 | 🔎 **부팅이 실패한다.** `acting-summary/config.py:load_settings`가 `RuntimeError`를 던지고 `app.py:create_app`이 부팅 중 이를 호출한다. **OpenAI와 정반대다** |
| **`GEMINI_MODEL`** | **`gemini-2.5-flash`** (`acting-summary/config.py:DEFAULT_MODEL`) | 기본값 사용 |
| `ANALYSIS_LEASE_SEC` | **1800** (`config.py:DEFAULT_ANALYSIS_LEASE_SEC`) | 기본값 사용 |
| **`SENTRY_DSN`** | 없음 | 조용히 넘어간다 — 켜지 않는다 (`observability.py:init_sentry`). **M5 대상**, 아래 참조 |
| **`SENTRY_ENVIRONMENT`** | `local` | 기본값 사용 |
| **`SENTRY_RELEASE`** | `unknown` | 기본값 사용 |

#### 🔎 Sentry(`SOMA-326`)는 M4가 이식하지 않는다 — M5 산출물이다

5차 개정에서 흡수한 dev 전진분이다. `observability.py`(88줄)가 신설돼 `app.py:create_app`이 부팅 시 `observability.py:init_sentry`를 부른다. **`openapi.json`은 변하지 않았으므로 계약 동등성 판정 밖이다** — 하네스도 이 층을 보지 않는다(`SENTRY_DSN`이 없어 꺼진 채로 돈다).

- **M4는 이 층을 이식하지 않는다.** M4는 이미 §A~§G로 가장 큰 사이클이고, 관측 배선은 LLM 계약과 무관하다
- **M5 컷오버 산출물에 넣는다.** Java 프로세스가 파이썬을 대체하는 순간 에러 수집이 끊기면 안 된다. 웹(`apps/web/src/lib/observability/sentry-shared.ts`)과 같은 원칙 — DSN 없으면 미기동, 주소의 UUID를 `<id>`로 가림, `send_default_pii=False`, 트레이싱 미사용
- **"파이썬 기능 잔여 0" 판정에서는 `observability.py`를 이식 대상으로 센다.** 비활성 유틸리티(`_cache_path`·`clip_head`)와 달리 운영에서 실제로 켜져 있다(dev·운영 배포 완료)

**OpenAI는 SDK를 쓰지 않는다.** 파이썬도 `httpx`로 REST를 직접 친다. Java도 `RestClient` 동형 이식이 기본안이며, 재시도 상수를 값까지 옮긴다:

- 시도 **4회**(`acting-llm/openai_client.py:_ATTEMPTS`), 지수 백오프 **1→2→4초**, 재시도 대상은 **`{429, 503}`만**, 요청 타임아웃 **120초**
- 연결 오류(`httpx.RequestError`)는 마지막 시도에서만 전파된다
- 오류 메시지가 사용자에게 보인다 — 429·503은 "지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.", 그 밖은 "OpenAI가 HTTP {status}로 응답했습니다." (`acting-llm/openai_client.py:_api_error`)
- `generate_text`는 `(text, TokenUsage)`를 돌려준다. **토큰 사용량이 반환 계약의 일부**다. 응답에서 `output_text`를 우선 읽고, 없으면 `output[].content[]` 중 `type == "output_text"`를 이어붙인다. 최종 텍스트가 비면 `refusal`을 모아 메시지에 싣는다(`acting-llm/openai_client.py:_output_items`·`acting-llm/openai_client.py:_token_usage`)

**이 마일스톤의 성패는 코드량이 아니라 "생성 요청이 Python과 동일한가"이다.** 자연어 출력은 비결정적이므로, 완료 판정은 **요청 golden + 결정적 후처리**로 한다.

## 범위 — M3에서 넘어온 것 포함

| 엔드포인트 | 이유 | M3 완료분 |
|---|---|---|
| `POST /v2/coach/start` | OpenAI 호출 (`coaching.py:build_router.coach_start`) | 저장 계층(`coach/CoachSessionStore.java`)·낙관적 락 |
| `POST /v2/coach/reply` | 〃 (`coaching.py:build_router.coach_reply`) | 〃 |
| **`POST /v2/coach/confirm`** | 리포트 생성 (`coaching.py:build_router.coach_confirm`) | `coach/OwnedReportSource.java` |
| **`POST /v2/reports`** | 리포트 생성 (`reports.py:build_router.create_report`) | 저장 계층 완료. `GET` 둘은 M3에서 노출됨 |

**리포트 생성 진입점이 셋이다.** `coach_start`·`coach_reply`는 턴이 `complete`가 되면 그 자리에서 `coaching.py:_generate_completed_turn_report`를 부르고, `coach_confirm`·`create_report`는 `sync_operations.py:generate_source_report`를 부른다. 같은 `acting-report/engine.py:generate_report`로 모이지만 **인자를 만드는 경로가 다르다** — 한쪽만 맞추면 나머지가 조용히 어긋난다.

### 🔎 LLM을 부르지 않는 경로가 셋이다

호출 횟수가 계약이다 — 스텁 호출 수(`budget`)로 판정되므로 한 번이라도 새면 시나리오가 갈린다.

1. **`coach_start`의 resume** — `req.restart`가 false이고 열린 코치 세션이 있으면 생성 없이 기존 대화를 돌려준다(`coaching.py:_resumed_coach_payload`, `SOMA-304`). 주의: resume 분기 **안에도** `has_report_for_practice_session` 검사가 있어 리포트가 이미 있으면 409 `report already exists for practice session`이다. 순서가 뒤집히면 이미 끝난 세션이 되살아난다
2. **`create_report`의 기존 리포트** — `store.get_practice_report_for_handoff(source.handoff_id)`가 JSON을 돌려주면 `generate_source_report`를 **건너뛰고** 그 JSON으로 sync operation만 성공시킨다
3. **`coach_confirm`의 기존 리포트** — 같다. `req.confirmed`이고 `handoff_id`가 있을 때만 조회한다

### 🔎 `coach_confirm`의 커밋 순서 — 실패해도 되돌아가지 않는다

`confirm_latest_handoff` → **커밋** → 외부 LLM 호출 → 리포트 저장, 이 순서다. `db/store.py:PostgresStore.confirm_latest_handoff`가 자기 트랜잭션(`self._session_factory.begin()`)으로 confirmation을 upsert하고 `confirmed`면 코치 세션을 `CLOSED`로 바꾼 뒤 반환한다.

따라서 **뒤이은 리포트 생성이 502로 죽어도 확인과 세션 닫힘은 남는다.** Java가 확인·닫힘·리포트 저장을 한 트랜잭션으로 묶으면 502 이후 `/v2/coach/reply`가 Python은 409 `session is closed`, Java는 통과로 갈린다. **묶지 않는다.**

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
- 🔧 **파싱 실패 시 총 2회 시도 = 재시도 1회다.** `for _ in range(2)`가 생성 호출을 감싸므로 **두 번째 응답도 파싱에 실패하면 그대로 `SummaryParseError`**다. 3차 개정본의 "재시도 2회"는 틀렸다. 예외 문구도 단수형 `"failed to parse after retry: {last_err}"`다
- 파싱은 `response.parsed` 우선, 없으면 `response.text` JSON 파싱 (`acting-summary/summarizer.py:_parse`)
- **Files API** — 업로드 → `PROCESSING` 폴링(기본 **300초** 타임아웃 · **2초** 간격) → ACTIVE 아니면 `FileActiveTimeout` → 분석 → delete (`acting-summary/summarizer.py:_wait_active`)
- **`files.delete`는 best-effort** — `finally` 안의 `try`로 감싼다. Java에서 예외를 전파하면 **성공한 분석이 실패로 뒤집힌다**
- **후처리는 `acting-summary/summarizer.py:_filter_observations` 하나다** — `start_ms >= 0`, `end_ms > start_ms`, `end_ms <= duration_ms`를 통과한 관찰만 남기고 **앞에서 3개로 자른다**. 관찰 0개도 정상이다
- 🔧 **응답 캐시(`acting-summary/summarizer.py:_cache_path`)는 비활성 유틸리티다.** `cache_dir`이 주어질 때만 열리는데 **운영 호출자는 넘기지 않는다** — `analysis_worker.py:SummaryAnalyzer.analyze`도, 앱 설정도 캐시 디렉토리를 모른다. 넘기는 곳은 `acting-summary/tests/test_summarizer.py`뿐이다.
  - **Java에서 워커 경로에 캐시를 켜지 않는다.** 켜면 Python이 하는 Gemini 호출을 건너뛰어 스텁 호출 수가 어긋난다
  - "파이썬 기능 잔여 0" 판정에서는 **비활성 유틸리티 parity**로 분류한다. 이식하든 않든 엔드포인트 계약에 영향이 없다
- **ffmpeg 압축** (`acting-summary/compress.py:compress_for_gemini`) — 파라미터를 값까지 옮긴다: `-threads 1`(두 번 나온다) · `scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2` · `-r 10` · `libx264` · `-preset ultrafast` · `-crf 28` · `-pix_fmt yuv420p` · `aac 64k` · `-ac 1` · `+faststart`. 타임아웃 **600초**
  - **폴백 5경로** — ①`<= 15MB`(`acting-summary/compress.py:MIN_BYTES`) ②ffmpeg 부재 ③실행 실패·타임아웃(산출물 삭제) ④산출물이 없거나 0바이트 ⑤**산출물이 원본보다 크거나 같음**. 다섯 모두 원본 경로를 그대로 돌려준다
  - 압축본을 쓴 경우 **호출자가 지운다**(`analysis_worker.py:SummaryAnalyzer.analyze`의 `finally`)

### B. `acting-agent` — 코치

`engine.py`(138) · **`prompt.py`(1219)** · `schema.py`(50) · `store.py`(80) · `summary_schema.py`(30) · `config.py`(15). **그리고 `acting-llm/validate.py`(50) · `acting-llm/forbidden.py`(77).**

**프롬프트가 이 산출물의 대부분이다.** 1219줄을 한 글자도 바꾸지 않고 옮긴다 — 공백·줄바꿈·한글 조사까지. 분기는 `acting-agent/prompt.py:select_prompt`가 `blockage_kind`로 고른다.

생성 호출은 평문이다 — `generate(system_prompt, build_chat_prompt(session, user_message))` 하나뿐이고 **temperature·schema를 지정하지 않는다**(`acting-agent/engine.py:_generate_validated`).

**폴백 사슬을 순서대로 재현한다:**

1. `acting-agent/engine.py:parse_coaching_response` — 앞뒤 ` ```json ` 펜스를 정규식으로 벗긴다(대소문자 무시). JSON이 아니거나 `message`가 문자열이 아니면 **원문 전체를 message로 삼고** `status="continue"`·`handoff=null`
2. `status == "complete"`이고 `handoff`가 **dict일 때만** complete로 인정한다. 둘 중 하나라도 아니면 continue로 강등되고 handoff는 버려진다
3. `acting-llm/validate.py:validate_turn` 실패 시 → `acting-agent/prompt.py:build_regeneration_prompt`로 **재생성 1회**
4. 재생성도 실패하면 `acting-agent/prompt.py:safe_template` 안전 문장 + `status="continue"`

🔎 **검증 계약이 재생성 여부를 가른다 — 문자열까지 계약이다.** 3차 개정본은 `validate_turn`을 이름만 적었다. 실제 내용:

- `acting-llm/forbidden.py:scan_generated_strings` → `acting-llm/forbidden.py:scan_forbidden`이 **NFKC 정규화** 후 `acting-llm/forbidden.py:LITERAL_FORBIDDEN` 목록(수십 개 — `점수`·`등급`·`강점`·`약점`·`진정성`·`리포트`·`ANALYSIS`·`blockage_type` 등)과 정규식을 검사한다
- `acting-llm/validate.py:_TIMECODE_PATTERNS` **정규식 5개** — `12:34` 꼴, `N초에서 M초`, `N~M초`, `N초에/쯤/구간/지점`, `N분 M초`
- 검사는 셋이고 순서가 `acting-llm/validate.py:_VALIDATION_KEYS`(`sentence_limit`·`forbidden_language`·`timecode`)로 고정돼 있다. **코치는 `enforce_sentence_limit=False`**라 길이 검사가 꺼진다(170자 기준은 다른 호출자용)
- **실패 메시지가 재생성 프롬프트에 그대로 들어간다** — `"응답이 {N}자입니다. 170자 이내여야 합니다."`, `"금지어가 노출됐습니다: {목록}"`, `"응답에 시각이 들어 있습니다. 숫자를 빼고 대사나 동작으로 그 순간을 가리킵니다."` 이 한국어 문장이 다르면 **재생성 요청 자체가 달라진다**

이 층이 어긋나면 같은 LLM 출력이 Python에서는 재생성·안전 문장이 되고 Java에서는 그대로 노출된다. **응답과 LLM 호출 횟수가 동시에 갈린다.**

**마무리 요청 감지** — `acting-agent/engine.py:reply`는 배우 텍스트에 `"그만"`·`"종료"`·`"끝"` 중 하나라도 **포함**되면 `acting-agent/engine.py:_CLOSING_TURN_INSTRUCTION`을 사용자 메시지 **뒤에 이어붙인다**(`acting-agent/engine.py:_CLOSING_WORDS`). 저장되는 턴 텍스트는 **붙이기 전의 원문**이다 — 지시문이 대화 기록에 남으면 안 된다.

**턴 적재 순서** — `acting-agent/engine.py:start`는 `actor`(= `blockage_detail` 또는 `goal`) → `ai`, `reply`는 `actor` → `ai`. 생성 **후에** 추가하므로 프롬프트에는 직전 턴까지만 들어간다.

- **`SessionWriteConflict` → 409 `session changed concurrently`** (`coaching.py:build_router.coach_reply`). 낙관적 락은 M3의 `coach/CoachSessionStore.java`를 쓴다

### C. `acting-report` — 리포트

`engine.py`(167) · `prompt.py`(382) · `schema.py`(85) · `summary_schema.py`(15) · `config.py`(15).

- 프롬프트는 둘 — `acting-report/prompt.py:REPORT_ANALYSIS_PROMPT`·`acting-report/prompt.py:REPORT_EXPRESSION_PROMPT`
- **입력 JSON을 만드는 규칙이 계약이다**(`acting-report/engine.py:build_report_input`). `json.dumps(..., ensure_ascii=False, indent=2)`로 직렬화해 보낸다 — **들여쓰기 2칸·한글 raw**가 프롬프트의 일부다
  - `analysis`: `{video_summary, confirmed_handoff, confirmation}`
  - `expression`: 위에 `analysis_handoff`·`expression_handoff`가 더해진다
  - `video_summary`는 `ObservationPack`으로 검증한 뒤 `model_dump(mode="json")`한 것이다
- **차단 경로**(LLM을 부르지 않는다) — `confirmed`가 false거나 handoff가 없으면, 또는 expression인데 `acting-report/engine.py:_expression_ready`가 false면 `BlockedReport`를 즉시 돌려준다. 사유 문자열이 갈린다: `confirmed_analysis_handoff_required` / `confirmed_expression_handoff_required`
  - `_expression_ready`는 `experiment.tested is True` **그리고** `experiment.instruction`이 비지 않은 문자열 **그리고** `observed_change`가 비지 않은 문자열일 때만 참이다
- 파싱(`acting-report/engine.py:_parse_report`) — 펜스 벗기기 → dict 아니면 `ReportParseError` → `report_type == "blocked"`면 `BlockedReport` → analysis면 `source_handoff_id`를 **주입해서** 검증 → expression이면 `source_handoff_ids = {analysis, expression}`를 **주입해서** 검증. 검증 실패는 `ReportParseError`
- **`ReportParseError` → 502**, 그리고 sync operation을 `report_parse_error`로 실패시킨다. 네 진입점 모두 같다. **`coach_confirm`에서는 이 502가 confirmation을 되돌리지 않는다**(§범위 참조)

### D. 분석 워커

`analysis_worker.py`(354) → `@Scheduled` + `ThreadPoolTaskExecutor`.

**lease 상태 전이는 `/SPEC.md` §5-7의 표를 그대로 구현한다.** 특히:
- lease 만료됐어도 재선점 전이면 **완료 허용**
- `release`는 **`attempt_count`를 되돌리지 않는다**
- **오류 분류가 전이를 가른다**(`analysis_worker.py:analysis_error_code`) — `FileActiveTimeout`·`TimeoutError` → `gemini_timeout`, `SummaryParseError` → `gemini_parse_error`, `UnsupportedMediaError` → `unsupported_media`. **이 셋만 즉시 `FAILED`**이고 나머지(S3·ETag 불일치·그 밖 전부)는 `None`을 돌려받아 **`PENDING` 재큐** → 3회 소비 후 sweep이 `FAILED`
- `LeaseOwnershipError`는 **아무것도 하지 않고 로그만 남긴다** — 실패 처리도 하지 않는다

`analysis_worker.py:AnalysisWorker.run_once` 골격:
1. `claim_next_external_operation(kind="analyze")` — 없으면 **false 반환**(하네스의 `processed: 0`)
2. 컨텍스트 없음 → `unsupported_media`로 fail, **true 반환**
3. `mime_type`이 `video/`로 시작하지 않음 → `unsupported_media`로 fail
4. 임시 파일 확장자는 **object key의 suffix, 없으면 `.video`**
5. 다운로드 → **ETag 대조** → 불일치면 `ObjectETagMismatchError`(→ 재큐)
6. `SummaryAnalyzer.analyze` → 완료 전이
7. `finally`에서 임시 파일 삭제

**`analysis_worker.py:SummaryAnalyzer.analyze` 순서가 계약이다**: duration 확정 → 압축 → **관찰 생성** → **전사** → 결과 조립. 전사가 관찰 뒤에 온다.

🔎 **음성 전사** (`analysis_worker.py:SummaryAnalyzer._transcribe`)
- **`blockage_kind != "분석"`이면 건너뛴다.** 한글 리터럴이 분기 조건이다
- `acting-llm/media.py:extract_audio`로 앞 **120초**(`analysis_worker.py:TRANSCRIPTION_MAX_DURATION_MS`)를 mp3(`libmp3lame -q:a 4`)로 뽑아 `transcribe_audio`에 넘긴다. 시스템 프롬프트는 `analysis_worker.py:TRANSCRIPTION_SYSTEM_PROMPT`(한국어 4개 규칙) 원문 그대로
- **모든 예외를 삼킨다** — `logger.warning("transcription failed; continuing analysis")`만 남기고 빈 튜플을 돌려준다. 대사 없는 분석이 정상 완료된다
- `finally`에서 임시 디렉토리를 통째로 지운다(`shutil.rmtree(parent)`)
- 후처리 `analysis_worker.py:transcript_segments_from_text` — CRLF/CR을 LF로 정규화 → 줄 단위 분할 → 각 줄을 **문장부호 `.!?。！？` 뒤 공백**에서 다시 분할 → strip 후 빈 줄 제거. **결정적이므로 golden 대상이다**

🔎 **duration 판정** (`analysis_worker.py:_video_duration_ms`) — declared 값이 있고 0보다 크면 그것을 쓰고, 없으면 **ffprobe**(`-show_entries format=duration`, 30초 타임아웃)로 구해 **반올림**(`round`)한다. ffprobe 부재·실패·0 이하는 전부 `UnsupportedMediaError` → **즉시 FAILED**다.

🔧 **ffmpeg 실행 함수는 셋이지만 운영 call graph는 둘이다.** `acting-llm/media.py:clip_head`는 저장소 전체에서 호출자가 없다(실측). 실제 경로는 `compress_for_gemini`(600초)와 `extract_audio`(120초) 둘이고, `acting-llm/media.py:_FFMPEG_LOCK` 하나를 공유한다 — **512MB 인스턴스에서 ffmpeg 두 개가 겹치면 OOM이라는 것이 락의 이유이므로, 압축과 전사가 같은 락을 다투는 것이 계약이다.** `clip_head`는 비활성 유틸리티로 분류한다.

`analysis_worker.py:AnalysisWorker.sweep`은 `(만료 업로드 수, 소진 operation 수)`를 돌려준다. 객체 삭제는 현재 `DeleteObject` 권한이 없어 조용히 실패 중이다 — **현행 동작을 그대로 재현한다**(예외를 삼키고 warning).

`analysis_worker.py:AnalysisWorkerPool` — concurrency만큼 데몬 스레드, poll **2초**, sweep **60초**, **인덱스 0 스레드만 sweep**. 일감이 없을 때만 대기한다.

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

🔎 **두 claim의 eligibility가 다르다. 같게 만들면 안 된다.**

| | `db/store.py:PostgresStore.claim_external_operation` (by-id, sync 요청) | `db/store.py:PostgresStore.claim_next_external_operation` (worker) |
|---|---|---|
| 공통 | `attempt_count < MAX_EXTERNAL_OPERATION_ATTEMPTS(3)` | 같음 |
| `PENDING` | `lease_token IS NULL`이면 선점 | 같음 |
| `RUNNING` | `lease_expires_at < now`면 선점 | 같음 |
| **`FAILED`** | **`lease_token IS NULL`이면 재선점한다** | **해당 절이 없다 — 건너뛴다** |
| lease 길이 | **15분** (`sync_operations.py:SYNC_OPERATION_LEASE`) | **1800초 기본** (`config.py:DEFAULT_ANALYSIS_LEASE_SEC`, `ANALYSIS_LEASE_SEC`로 조정) |

같게 만들면 실패한 sync 요청의 같은 `X-Request-Id` 재시도가 조기 소진되거나, 워커가 방금 실패시킨 작업을 즉시 다시 가져간다. lease 길이를 임의로 고르면 409 `request is still processing` 구간과 재선점 시점이 함께 어긋난다.

**순서를 지킨다** — 워커를 만들기 전에 저장 계층을 세우고 **§5-7 다섯 행 + 위 표의 두 갈래를 각각 Testcontainers로 고정한다.** `release`가 `attempt_count`를 되돌리지 않는 것과 3회 소비 후 sweep이 `FAILED`로 넘기는 것은 **응답에 드러나지 않아** 하네스가 잡지 못한다.

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

### G. ✅ 하네스 게이트 추상화 — **선행 작업으로 완료**(`89b728f`)

**4차 개정 신설, 5차 개정에서 구현 완료.** 3차 개정본은 "하네스 쪽 배선은 이미 되어 있으므로 남은 것은 java 쪽 조건뿐"이라고 적었다. **틀렸다.**

`tools/contract-harness/contract_harness/scenarios/inflight.py`와 `tools/contract-harness/contract_harness/scenarios/worker.py`의 게이트 헬퍼는 HTTP 제어 표면이 아니라 **`ctx.backend.runtime`을 직접 읽었다**. `tools/contract-harness/contract_harness/backends.py:JavaBackend`에는 `runtime` 속성이 없으므로(`_client`만 있다), Java가 M4 기능과 제어 표면을 전부 올바르게 구현해도 게이트 시나리오는 `AttributeError`로 죽었다. **진입 점검에서 실제로 재현해 확인했다** — `AttributeError: 'JavaBackend' object has no attribute 'runtime'`.

M2·M3에서 두 번 나온 "완료 기준이 도구 능력보다 앞선다"가 세 번째로 재현된 것이다. `/SPEC.md` §3-4의 "기존 `apps/api` 수정 금지"는 `tools/`에 적용되지 않는다.

**🔧 다만 4차 개정은 규모를 과대평가했다.** `tools/contract-harness/contract_harness/stubs.py:TextGeneratorStub.state`가 이미 `blocked`·`in_block`·`in_block_count`·`timed_out`을 `stub-state` 응답에 싣고 있었고, release·rearm도 이미 제어 payload 경유였다. 실제로 남아 있던 것은 **`backend.runtime` 직접 접근 3곳**뿐이다.

**구현된 형상** — `tools/contract-harness/contract_harness/scenarios/gate.py` 신설:

- 게이트 대기·재무장·해제를 전부 `Backend.control("stub-state", ...)` 경유로 모았다. 시나리오에 `backend.runtime` 접근이 **0건**이다(AST 검사로 고정)
- 대기는 **`in_block_count` 폴링**이다. 🔎 **폴링은 `ctx.backend.control`(비기록)로 한다** — `ctx.control`은 스텝을 시나리오 기록에 남기므로, 백엔드마다 폴링 횟수가 달라지면 그 스텝 수가 그대로 L2 diff가 된다. 확인이 끝난 뒤 호출부가 `ctx.control`을 한 번 부르는 현행 스텝 수를 유지한다
- `stub-state` payload가 **`stub` 이름**을 받는다. 동시성 시나리오는 특정 스텁만 풀어야 하는데, 이름 없이 전부 푸는 것과 구별이 필요하다. 이름이 없으면 게이트 있는 스텁 전부가 대상이다(종전 동작)
- 양쪽 백엔드가 같은 코드를 밟으므로 추상화 자체가 매 실행마다 검증된다

**🔎 Java 대상 self-test는 아직 성립하지 않는다.** 게이트 시나리오는 LLM 스텁을 통과해야 하므로 **Java에 LLM 층이 선 뒤에야** 실제로 구동된다. 지금 검증된 것은 ①fastapi↔fastapi 26개 diff 0 유지 ②`JavaBackend`에서 `AttributeError`가 사라지고 제어 표면까지 도달한다는 것 둘이다. **완전한 self-test는 §B·§C·§D가 선 뒤 완료 기준으로 확인한다** — 이것을 M4의 마지막 관문으로 남긴다.

## 검증 — 관문은 golden, smoke는 참고

**실 LLM 호출의 "구조 동등성"만으로는 생성 설정 차이를 검출할 수 없다.** `temperature`나 `seed`가 빠져도 스키마는 여전히 맞는다. 따라서 관문을 나눈다.

### 관문 ① 요청 golden test (필수)

나가는 요청 전체를 캡처해 Python과 비교한다. 실호출 없이 스텁으로 한다.

- **Gemini**: 생성 설정 전 필드(temperature·top_p·top_k·seed·media_resolution·response_mime_type·response_schema) + `contents` 배열의 **순서와 내용** + `system_instruction` + 모델명(**기본값 `gemini-2.5-flash`**)
- **OpenAI**: 요청 바디 `{model, instructions, input}` 세 필드. `input`은 **직렬화된 문자열까지** 비교한다 — 리포트는 `indent=2`·`ensure_ascii=False`가, 코치는 `build_chat_prompt` 출력이 그 자리에 온다
- **재생성 요청**: `build_regeneration_prompt`에 실린 **검증 실패 메시지 문자열**까지 비교한다
- **전사**: multipart 필드(`model`·`response_format=json`·`prompt`)와 파일 파트 이름(`audio.mp3`·`audio/mpeg`)
- **호출 횟수**: LLM을 부르지 않는 세 경로(§범위)에서 스텁 호출 수가 **증가하지 않는다**

### 관문 ② 결정적 후처리 test (필수)

같은 LLM 응답을 넣었을 때 다음이 **완전히 일치**해야 한다.

- `acting-summary/summarizer.py:_filter_observations` — 경계값(`start_ms == 0`, `end_ms == duration_ms`, `end_ms == start_ms`)과 **4개 이상일 때 앞 3개 절단**
- **파싱 재시도** — `[실패, 성공]`은 성공, **`[실패, 실패, 성공]`은 `SummaryParseError`**(총 2회 시도이므로 세 번째를 보지 않는다)
- `acting-agent/engine.py:parse_coaching_response` — 펜스 있음/없음, JSON 아님(원문 통과), `message` 비문자열, `complete`인데 handoff가 dict 아님(→ continue 강등)
- `acting-llm/validate.py:validate_turn` — 금지어 리터럴 적중(NFKC 정규화 포함), 시간코드 5패턴 각각, 실패 메시지 문자열과 **순서**
- `analysis_worker.py:transcript_segments_from_text` — CRLF·연속 개행·문장부호 분할·전각 문장부호
- `acting-report/engine.py:build_report_input`·`acting-report/engine.py:_expression_ready` — 차단 경로 두 사유 문자열
- `acting-report/engine.py:_parse_report` — handoff id 주입 형상(analysis는 `source_handoff_id`, expression은 `source_handoff_ids` dict)

### ✅ 관문 ③ production-envelope 스파이크 — **통과, SDK 채택 확정**(2026-08-12)

**M0의 Gemini PASS는 6초·80KB 영상 1건이었다.** SDK에 세 API가 존재한다는 것만 보였고 실제 부하·실패 경로는 건드리지 않아, SDK 채택이 잠정 결정으로 낮춰져 있었다. `ProductionEnvelopeSpikeTest`가 4건 전부 통과해 **확정으로 올린다. raw REST 전환은 없다.**

| 항목 | 결과 |
|---|---|
| post-compression 업로드 → 폴링 → 구조화 출력 | ✅ **2,445,640 B** |
| **압축 실패 시의 원본**(15MB 초과) 업로드 — 다중 chunk | ✅ **98,414,903 B → 23.5초에 ACTIVE** |
| 파싱 첫 실패 후 재시도 성공 / 2회 모두 실패 | ✅ 총 2회 시도 (`spike/ParseRetryLoop.java`) |
| **`files.delete` 예외 주입** | ✅ 삼키면 분석 결과가 남는다 |
| 워커 lease 3회 예산 소진 | ⏳ **§F-1로 이월** — Java에 sweep 대응물이 아직 없다 |

🔎 **압축률이 2.5%다.** 운영에서 Gemini로 가는 것은 보통 2~3MB이고 98MB가 그대로 가는 것은 압축 실패 시뿐이다 — **다중 chunk는 예외 경로**다. 다만 그 경로가 열리는 것을 확인했으므로 §A의 폴백 5경로를 그대로 옮겨도 업로드에서 막히지 않는다.

⚠ 합성 영상이라 **분석 품질은 보지 않았다**(`observations=1`). 프롬프트 정확도는 관문 ①의 요청 golden이 판정한다.

**부수 사실**: `google-genai`를 `testImplementation` → `implementation`으로 올리면 `bootJar`가 약 12MB 늘어난다(70 → 82MB). M5의 인스턴스 판단과 함께 본다.

### 참고 ④ 실 LLM smoke (비결정적)

소수 케이스로 실제 호출해 스키마 준수·필드 존재·enum 범위를 본다. **완료를 막는 관문으로 쓰지 않는다.** 비용이 들므로 케이스를 고정한다.

## 완료 기준 체크리스트

- [ ] `POST /v2/coach/start`·`/reply`·**`/confirm`**, `POST /v2/reports` 노출. 409 `session changed concurrently` 재현
- [ ] **LLM을 부르지 않는 세 경로** — resume 분기, `create_report`·`coach_confirm`의 기존 리포트. 스텁 호출 수 불변으로 판정
- [ ] resume 분기 안의 `report already exists for practice session` 409 재현
- [ ] **`coach_confirm`의 커밋 순서** — 리포트 502 뒤에도 confirmation과 세션 `CLOSED`가 남는다(DB projection으로 비교)
- [ ] **요청 golden**: Gemini 생성 설정 전 필드 + contents 순서 + system_instruction + 모델명, OpenAI 세 필드 + 직렬화된 input 문자열, **재생성 프롬프트의 실패 메시지 문자열**
- [ ] summary의 `media_resolution=LOW`가 실제로 실려 나간다 (비용 3배 방지)
- [ ] **파싱은 총 2회 시도(재시도 1회)** — 세 번째를 보지 않는다. 최종 실패는 `SummaryParseError` 상당
- [ ] **`files.delete` 실패가 분석 성공을 뒤집지 않는다**
- [ ] **응답 캐시를 워커 경로에서 켜지 않는다** — 비활성 유틸리티 parity
- [ ] 코치 **폴백 사슬 4단**(펜스 → 원문 통과 → 재생성 1회 → 안전 문장)과 complete 강등 규칙
- [ ] **검증 계약** — 금지어 목록·NFKC·시간코드 정규식 5개·실패 메시지 문자열·검사 순서. 코치는 길이 검사 꺼짐
- [ ] 마무리 요청 3단어 감지, **저장 턴에는 지시문이 붙지 않는다**
- [ ] 리포트 **차단 경로 두 사유 문자열**과 `_expression_ready` 세 조건
- [ ] `ReportParseError` → **502** + `report_parse_error` 실패 전이 (네 진입점 모두)
- [ ] ffmpeg: 파라미터 동일, **압축·전사가 락 하나를 공유**, 타임아웃 600/120초, 압축 **폴백 5경로**. `clip_head`는 비활성 유틸리티
- [ ] ffprobe duration 판정과 **`unsupported_media` 즉시 FAILED**
- [ ] **음성 전사**: `blockage_kind == "분석"` 조건, 120초 상한, 실패 삼킴, `transcript_segments_from_text` 일치
- [ ] Files API 업로드·폴링(300초/2초)·삭제. 타임아웃 시 `FileActiveTimeout` 상당
- [ ] OpenAI 재시도 상수 4회·1→2→4초·`{429,503}`·120초, **오류 메시지 문자열 두 종**
- [ ] **환경변수 계약**: `GEMINI_API_KEY` 없으면 **부팅 실패**, `OPENAI_API_KEY` 없으면 **호출 시점 실패**, `GEMINI_MODEL` 기본 `gemini-2.5-flash`
- [ ] 워커: **`/SPEC.md` §5-7 전이표 5행 + claim 두 갈래(FAILED 재선점 / FAILED 건너뜀) + lease 15분·1800초를 각각 Testcontainers로 테스트** (F-1, 워커보다 먼저). **관문 ③에서 이월된 "lease 3회 예산 소진"도 여기서 닫는다**
- [ ] **`run_once()` 동기 훅** 제공
- [ ] **`ANALYSIS_WORKER_ENABLED` 스위치** 제공
- [ ] **F-2 요청 검증 구조 전환** — 422 다건 누적 · 명시적 null 구분 · `literal_error` 판별자 · 게이트가 바디 검증보다 먼저. **새 라우트를 열기 전에 끝낸다**
- [ ] **F-3 admin stats 55필드 + 중첩 모델 둘**, 소스 기반 inventory 대조 검사, `admin` 시나리오 diff 0
- [x] **G. 하네스 게이트 추상화** — 시나리오에서 `backend.runtime` 접근 제거, `stub-state`의 `in_block_count` 폴링으로 전환 (`89b728f`, 선행 완료)
- [ ] **G-2. 게이트 시나리오가 Java 대상으로 실제 완주한다** — §G의 나머지 절반. §B·§C·§D가 선 뒤에만 성립하므로 **M4의 마지막 관문**이다. `inflight-replay`·`lease-stolen`·`report-parse-error`·`concurrency` 넷이 java 타겟에서 diff 0
- [ ] 🔎 **제어 표면의 나머지 셋을 채운다** — `run-worker-once`·`run-sweep`·`stub-state`. 🔁 3차 개정본의 "5개"는 틀렸다. `tools/contract-harness/contract_harness/config.py:CONTROL_SURFACE`는 **6개**이고 M3가 `advance-clock`·`db-projection`·`reset-state`를 채웠다(`harness/HarnessController.java`)
  - **M1이 확정한 transport**: `POST /__harness/<name>`, 요청·응답 모두 JSON. 요청 바디는 `advance-clock`이 `{"seconds": N}`, `db-projection`이 `{"include": [...]}`, 나머지는 `{}`다. 응답 키는 `run-worker-once` → `{"processed": n}`, `run-sweep` → `{"expired_uploads": n, "exhausted_operations": n}`, `advance-clock` → `{"offset_sec": n}`, `stub-state`·`db-projection`은 `tools/contract-harness/contract_harness/wrapper.py:BackendRuntime.control`·`tools/contract-harness/contract_harness/wrapper.py:BackendRuntime.db_projection`의 형상을 그대로 따른다
  - **외부 의존 스텁의 값은 `tools/contract-harness/contract_harness/fixtures/`에서 읽는다**(`llm.json`·`s3.json`·`auth_providers.json`). **`llm.json`에는 계약이 셋 있다:**
    - **`budget`** — coach 24회·report 12회. 스텁 호출 예산이며 초과 시의 동작이 시나리오 판정에 쓰인다
    - **`$` 참조** — `by_marker["[[coach:complete]]"].handoff`의 값이 문자열 `"$analysis_handoff"`다. 최상위 `analysis_handoff` 객체로 **치환해서** 돌려줘야 한다
    - **마커는 프롬프트 전체에서 찾는다.** `[[report:parse_error]]`는 coach 응답의 `coach_summary` 안에 실려 리포트 프롬프트로 전파되고, 그때 스텁이 **JSON이 아닌 문자열**을 돌려줘 `ReportParseError` → 502 경로를 연다
- [ ] 🔎 **LLM 스텁 게이트**: 프롬프트에 `[[stub:block]]`(`tools/contract-harness/contract_harness/stubs.py:STUB_BLOCK_MARKER`)이 있으면 스텁이 신호가 올 때까지 멈춘다. 클레임을 잡은 뒤 LLM을 부르는 구조라, 이 게이트가 **sync operation이 running인 구간**을 결정적으로 만드는 유일한 훅이다(409 `request is still processing` 다섯 지점의 근거). 해제·재무장은 `stub-state`의 payload(`{"release": true}` / `{"rearm": true}`)로 한다. 🔧 **payload에 `{"stub": "coach_generate"}` 처럼 이름을 주면 그 스텁만** 건드리고, 없으면 게이트 있는 스텁 전부가 대상이다(§G에서 확정). 응답에는 스텁마다 `calls`·`remaining`·`budget`·`blocked`·`in_block`·**`in_block_count`**·`timed_out`을 싣는다 — 하네스의 대기가 `in_block_count` 폴링이므로 이 필드가 없으면 게이트 시나리오가 진행하지 못한다. 게이트에는 상한 시간을 둬 신호를 못 받아도 매달리지 않는다(파이썬은 `tools/contract-harness/contract_harness/stubs.py:STUB_BLOCK_TIMEOUT_SEC` 20초, 넘기면 `timed_out` 증가)
- [ ] 🔎 **M1에서 java 대상이라 못 돌린 검증이 여기서는 돌아야 한다**
  - **seed parity** — 하네스가 java contract 프로파일의 스키마 이름을 알아야 두 스키마 시드 지문을 대조할 수 있다. 지금은 "스키마 이름을 모른다"는 사유로 건너뛴다
  - **오류 계약 manifest·unknown key·레이트리밋 오염 검사** — 해당 시나리오가 java에서 실제로 돌아야 판정이 생긴다
  - **openapi 전 문서 semantic 비교** — `--only` 없이 돌리면 커밋된 계약 전체와 비교한다. M3는 M3 inventory slice로 판정했다
- [ ] 🔎 **contract 프로파일의 DB 스키마 이름을 하네스가 알 수 있어야 한다** — `tools/contract-harness/contract_harness/dbops.py`의 이름 붙은 조작이 대상 스키마에 직접 붙는다
- [ ] 🔎 **contract 프로파일에서 백그라운드 워커가 뜨지 않는다.** 시간 의존 동작은 `advance-clock`으로만 일어난다
- [ ] 🔎 **제어 표면이 운영 프로파일에 노출되지 않는다** — loopback 전용이며 기본 프로파일에서 라우트가 등록되지 않음을 테스트로 단언
- [ ] `auth/FixedWindowRateLimiter.java`의 `advanceContractClock()`·`reset()`을 contract 프로파일로 가르거나 가시성을 좁힌다 (M3 잔여)
- [ ] 🔎 **`spec/check-refs.py`를 보강한다** — 지금은 `spec/check-refs.py:SYMBOL_REF`가 완전한 `` `파일.py:심볼` ``만 인식해 축약(`:_parse`)과 산문 파일명(`engine.py`)을 통과시킨다. **이 문서가 세 번 틀린 근본 원인이다.** 코드 블록 밖의 `.py` 표기가 `SYMBOL_REF`에 매치되지 않으면 실패시키는 검사를 추가해, 다음 사이클이 같은 구멍에 빠지지 않게 한다
- [ ] 외부 호출이 트랜잭션 밖에 있다 (커넥션 점유 시간으로 확인)
- [ ] **M1 하네스 전량 통과** — G가 선행되어야 성립한다
- [ ] `openapi.json` **전체** diff 0 (datetime 통일 제외)
- [ ] 실 LLM smoke 통과 (참고 지표)
- [ ] **파이썬 기능 잔여 0** — 이식되지 않은 기능 목록이 비어 있음을 확인. 비활성 유틸리티(`_cache_path`·`clip_head`)는 별도로 표시하고, **`observability.py`는 M5로 이월했음을 명시**한다(§A-0)

## 하지 말 것

1. **프롬프트 문구를 개선하지 않는다.** 한 글자도 바꾸지 않는다. `acting-agent/prompt.py`만 1219줄이고, **금지어 목록과 검증 실패 메시지도 프롬프트의 일부**다
2. **생성 설정을 "정리"하지 않는다.** `seed=42`·`top_k=1`은 결정성 확보용이고 `media_resolution`은 비용 설정이다
3. **후처리 로직을 정리하지 않는다.** 관찰 상한 3개·문장 분할 규칙·강등 규칙은 계약이다
4. **`files.delete` 실패를 예외로 올리지 않는다**
5. **전사 실패를 예외로 올리지 않는다.** 대사 없는 분석이 정상 완료되는 것이 현행이다
6. **폴백을 "더 안전하게" 만들지 않는다.** 원문 통과·안전 문장은 사용자에게 보이는 동작이다
7. **재시도 횟수를 늘리지 않는다.** 파싱은 총 2회, OpenAI는 총 4회다
8. **두 claim의 조건을 통일하지 않는다** (§F-1)
9. **`coach_confirm`의 확인·닫힘·리포트를 한 트랜잭션으로 묶지 않는다** (§범위)
10. `DeleteObject` 권한 문제를 고치지 않는다 — 현행 동작 재현
11. 기존 `apps/api` 수정 금지. **단 `tools/contract-harness`는 §G에 한해 수정 대상이다**
12. 스코프 밖 리팩터링 일체
