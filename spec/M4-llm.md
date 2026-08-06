# M4 — LLM 파이프라인

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M4 사이클에만 적용된다.**

> **상세화 시점**: **M0의 Gemini 결론(SDK 채택 vs REST 직접)에 의존한다.** 사이클 진입 시 그 결론을 반영해 보강한다.
>
> ⚠ **2026-08-06 — 공급자가 둘이 됐다.** `SOMA-302`가 신규 패키지 `acting-llm`을 들이면서 코치·리포트가 **Gemini에서 OpenAI로 넘어갔다.** M0의 Gemini SDK 스파이크는 이제 **영상 분석 한 층에만** 답한 것이다. OpenAI 쪽은 별도 판단이 남았다(§A-0).

## 목적

`acting-summary`·`acting-agent`·`acting-report`·**`acting-llm`**과 분석 워커를 옮기고, M3에서 미뤄둔 LLM 의존 엔드포인트를 노출한다. 이 사이클이 끝나면 파이썬에 남는 기능이 없다.

### A-0. 공급자 지형 (먼저 읽는다)

| 층 | 공급자 | 엔드포인트 | 호출부 |
|---|---|---|---|
| `acting-summary` — 영상 분석 | **Gemini** | Files API 업로드 → `PROCESSING` 폴링 → `generate_content` | `acting-summary/summarizer.py:summarize` |
| `acting-agent` — 코치 | **OpenAI** | `POST https://api.openai.com/v1/responses` | `acting-agent/engine.py:_generate_validated` |
| `acting-report` — 리포트 | **OpenAI** | 같은 클라이언트 | `acting-report/engine.py` |
| `acting-llm` — 공용 | **OpenAI** | `:generate_text`, `:transcribe_audio` | `acting-llm/openai_client.py:generate_text` |

- 모델은 환경변수로 갈린다: `OPENAI_CHAT_MODEL`(기본 `gpt-5.6-terra`)·전사 모델·`OPENAI_API_KEY`. **환경변수 이름을 유지한다**(`/SPEC.md` §5-6과 같은 이유 — M5에서 배포 문서·양쪽 서버 `api.env`를 건드리지 않기 위해)
- **OpenAI 쪽은 공식 Java SDK를 전제하지 않는다.** 현재 파이썬 구현도 SDK가 아니라 `httpx`로 REST를 직접 친다(재시도 포함). 같은 형태로 `RestClient` 직접 호출이 기본안이며, SDK 채택은 M4 진입 시 판단한다
- `generate_text`는 `(text, TokenUsage)`를 돌려준다. **토큰 사용량이 반환 계약의 일부**다
- 재시도·오류 매핑(`_retrying_request`·`_api_error`)을 그대로 옮긴다 — 여기가 갈리면 사용자에게 보이는 오류 코드가 달라진다

**이 마일스톤의 성패는 코드량이 아니라 "생성 요청이 Python과 동일한가"이다.** 자연어 출력은 비결정적이므로, 완료 판정은 **요청 golden + 결정적 후처리**로 한다.

## 범위 — M3에서 넘어온 것 포함

| 엔드포인트 | 이유 |
|---|---|
| `POST /v2/coach/start`, `/v2/coach/reply` | **OpenAI** 호출 (`coaching.py:build_router.coach_start`·`.coach_reply` → `acting-agent/engine.py:_generate_validated`) |
| **`POST /v2/reports`** | **OpenAI** 호출 (`reports.py:build_router.create_report`). 저장 계층은 M3에서 완료 |

> 🔁 이 표는 1차 개정에서 "Gemini 호출"로 남아 있어 위 §공급자 표(`acting-agent`·`acting-report` = OpenAI)와 모순이었다. `SOMA-302` 이후 **이 세 엔드포인트에 Gemini는 관여하지 않는다.**
>
> `coach_start`는 🔁 **LLM을 호출하지 않는 경로가 하나 더 있다** — 열린 코치 세션을 이어받는 resume 분기(`SOMA-304`). 이식할 때 이 분기에서 생성 호출이 새지 않아야 한다. 판정 근거는 `spec/M1-harness.md`의 코치 resume 시나리오다.

## 산출물

### A. `acting-summary` — 영상 분석

**생성 요청을 그대로 옮긴다** (`acting-summary/summarizer.py:summarize`):

```
response_mime_type = "application/json"
response_schema    = SceneSummary
temperature        = 0.0
top_p              = 0.1
top_k              = 1
seed               = 42
media_resolution   = MEDIA_RESOLUTION_LOW
```

`media_resolution`은 비용 설정이다 — 영상 토큰을 초당 ~300→~100으로 줄인다(프레임당 258→64). 빠뜨리면 **비용이 3배가 된다.**

- **`contents=[uploaded, prompt]` 순서**를 지킨다 (`:136`)
- **파싱 실패 시 재시도 2회** (`for _ in range(2)`, `:134`). 최종 실패는 `SummaryParseError`
- **`files.delete`는 best-effort** — `finally` 안의 `try`로 감싸 실패가 성공 결과를 뒤집지 않는다(`:150-152`). Java에서 예외를 전파하면 **성공한 분석이 실패로 뒤집힌다**
- 파싱은 `response.parsed` 우선, 없으면 `response.text` JSON 파싱
- **ffmpeg 압축** (`compress.py`) — 15MB 미만 건너뜀, 768px/10fps/모노, `-threads 1`, `ultrafast`, **동시 실행 1개 락**, 600초 타임아웃, ffmpeg 부재·실패 시 원본 폴백
- **Files API** — 업로드 → `PROCESSING` 폴링 → ACTIVE → 분석 → delete
- **후처리** (`_finalize`) — severity 계산(`_IMPACT_POINTS` + key score), anomaly 정렬(severity → key score → 시작시각 → 축 순서). **`_AXIS_ORDER`는 한글 배열** `["대사","템포","높낮이","움직임","표정","감정"]`

### B. `acting-agent` — 코치

`engine.py`(246) · `targeting.py`(284) · `guard.py`(127) · `prompt.py`(192) · `clip.py` · `knowledge.py`.

- 생성 설정은 `system_instruction` + `response_mime_type` + `response_schema`뿐이다(`acting-agent/engine.py:_generate_validated`). **summary와 달리 temperature 등을 지정하지 않는다** — 기본값을 그대로 둔다
- **형제 스키마 파싱 폴백**: `close` 유무만 다른 모델로 파싱돼 오면 필드를 옮겨 담는다(`acting-agent/engine.py:_generate_validated`). 이 폴백이 없으면 간헐적으로 실패한다
- **`SessionWriteConflict` → 409 `session changed concurrently`** (`coaching.py:build_router.coach_reply`)
- 낙관적 락은 M3에서 만든 `_save_coach_session` 대응물을 쓴다

### C. `acting-report` — 리포트

`engine.py` · `prompt.py` · 스키마. 저장 계층(`db/store.py:PostgresStore.complete_practice_report_operation`)은 M3 완료분을 쓰고 LLM 호출부만 연결한다. ⚠ 구 `complete_report_operation`은 `SOMA-302`로 사라졌다(`/SPEC.md` §7-1).

### D. 분석 워커

`analysis_worker.py`(258줄) → `@Scheduled` + `ThreadPoolTaskExecutor`.

**lease 상태 전이는 `/SPEC.md` §5-7의 표를 그대로 구현한다.** 특히:
- lease 만료됐어도 재선점 전이면 **완료 허용**
- `release`는 **`attempt_count`를 되돌리지 않는다**
- timeout·parse·unsupported는 **즉시 `FAILED`**, S3·기타는 **`PENDING` 재큐** → 3회 소비 후 sweep이 `FAILED`

그 밖에:
- **외부 호출을 트랜잭션 안에 넣지 않는다** (`/SPEC.md` §5-4-1)
- **`run_once()` 동기 훅을 반드시 제공한다** — 하네스가 워커를 결정론적으로 구동하는 유일한 수단(M1)
- **`ANALYSIS_WORKER_ENABLED` 스위치를 제공한다** — M5에서 두 백엔드가 같은 큐를 소비하지 않도록 owner를 하나로 고정하는 데 필요하다
- `sweep`의 객체 삭제는 현재 `DeleteObject` 권한이 없어 조용히 실패 중이다(`docs/archive/SPEC-SOMA-296-s3-instance-role.md` 5장). **현행 동작을 그대로 재현한다**

### E. keepalive

`keepalive.py` — `KEEP_ALIVE_URL`이 있을 때만 주기 핑. `/health`의 `keep_alive`가 이 설정 여부를 반영한다.

## 검증 — 관문은 golden, smoke는 참고

**실 Gemini 호출의 "구조 동등성"만으로는 생성 설정 차이를 검출할 수 없다.** `temperature`나 `seed`가 빠져도 스키마는 여전히 맞는다. 따라서 관문을 나눈다.

### 관문 ① 요청 golden test (필수)

Gemini에 나가는 요청 전체를 캡처해 Python과 비교한다. 실호출 없이 스텁으로 한다.
- 생성 설정 전 필드 (temperature·top_p·top_k·seed·media_resolution·response_mime_type·response_schema)
- `contents` 배열의 **순서와 내용**
- `system_instruction` 문자열
- 모델명

### 관문 ② 결정적 후처리 test (필수)

같은 LLM 응답을 넣었을 때 severity 계산·anomaly 정렬·형제 스키마 폴백이 **완전히 일치**해야 한다.

### 관문 ③ production-envelope 스파이크 (착수 전 필수)

**M0의 Gemini PASS는 6초·80KB 영상 1건이다.** SDK에 세 API가 존재한다는 것만 보였고 실제 부하·실패 경로는 건드리지 않았다(적대적 리뷰 지적). **SDK 채택은 잠정 결정이며 아래를 통과해야 확정된다:**

- **예상 최대 크기의 post-compression 파일** 업로드
- **압축 실패 시의 원본**(15MB 초과) 업로드 — SDK의 다중 chunk 경로가 열린다
- **JSON 파싱 첫 실패 후 재시도 성공** / **2회 모두 실패**
- **`files.delete` 예외 주입** → 분석 성공 결과가 뒤집히지 않는지
- **워커 lease 3회 시도 예산** 소진 경로

여기서 막히면 raw REST 경로로 전환한다. M0는 그 가능성을 배제하지 못했다.

### 참고 ④ 실 Gemini smoke (비결정적)

소수 케이스로 실제 호출해 스키마 준수·필드 존재·enum 범위를 본다. **완료를 막는 관문으로 쓰지 않는다** — 자연어 출력이 흔들리기 때문이다. 비용이 들므로 케이스를 고정한다.

## 완료 기준 체크리스트

- [ ] `POST /v2/coach/start`, `/v2/coach/reply`, `POST /v2/reports` 노출. 409 `session changed concurrently` 재현
- [ ] **요청 golden**: 생성 설정 전 필드 + contents 순서 + system_instruction + 모델명 일치
- [ ] summary의 `media_resolution=LOW`가 실제로 실려 나간다 (비용 3배 방지)
- [ ] 파싱 실패 시 **재시도 2회**, 최종 실패는 전용 예외
- [ ] **`files.delete` 실패가 분석 성공을 뒤집지 않는다**
- [ ] agent의 형제 스키마 폴백 동작
- [ ] ffmpeg: 동일 파라미터, 동시 실행 1개 락, 600초 타임아웃, 폴백 3경로(부재·실패·소용량)
- [ ] Files API 업로드·폴링·삭제. 타임아웃 시 `FileActiveTimeout` 상당
- [ ] **결정적 후처리 완전 일치** — severity 계산, anomaly 정렬(한글 축 순서 포함)
- [ ] 워커: **`/SPEC.md` §5-7 전이표 5행 각각을 테스트**
- [ ] **`run_once()` 동기 훅** 제공
- [ ] **`ANALYSIS_WORKER_ENABLED` 스위치** 제공
- [ ] 외부 호출이 트랜잭션 밖에 있다 (커넥션 점유 시간으로 확인)
- [ ] **M1 하네스 전량 통과** — 여기서 처음으로 전 시나리오가 관문이 된다
- [ ] `openapi.json` diff 0 (datetime 통일 제외)
- [ ] 실 Gemini smoke 통과 (참고 지표)
- [ ] **파이썬 기능 잔여 0** — 이식되지 않은 기능 목록이 비어 있음을 확인

## 하지 말 것

1. **프롬프트 문구를 개선하지 않는다.** 한 글자도 바꾸지 않는다
2. **생성 설정을 "정리"하지 않는다.** `seed=42`·`top_k=1`은 결정성 확보용이고 `media_resolution`은 비용 설정이다
3. **후처리 로직을 정리하지 않는다.** severity 임계값·정렬 순서는 계약이다
4. **`files.delete` 실패를 예외로 올리지 않는다**
5. `DeleteObject` 권한 문제를 고치지 않는다 — 현행 동작 재현
6. 기존 `apps/api` 수정 금지
7. 스코프 밖 리팩터링 일체
