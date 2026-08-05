# M4 — LLM 파이프라인

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M4 사이클에만 적용된다.**

> **상세화 시점**: **M0의 Gemini 결론(SDK 채택 vs REST 직접)에 전적으로 의존한다.** 사이클 진입 시 그 결론을 반영해 보강한다.

## 목적

`acting-summary`·`acting-agent`·`acting-report` 세 패키지(약 3.8k LOC)와 분석 워커를 옮긴다. 이 사이클이 끝나면 파이썬 코드에 남는 기능이 없다.

**이 마일스톤의 성패는 코드량이 아니라 "프롬프트가 Python과 같은 JSON을 뽑는가"이다.**

## 산출물

### A. `acting-summary` — 영상 분석

- **ffmpeg 압축** (`compress.py`) — `ProcessBuilder`로 커맨드 배열을 그대로 옮긴다. 보존할 것: 15MB 미만 건너뜀, 768px/10fps/모노, `-threads 1`, `ultrafast`, **동시 실행 1개 락**, 600초 타임아웃, ffmpeg 부재·실패 시 원본 폴백
- **Files API** — 업로드 → `PROCESSING` 폴링 → ACTIVE → 분석 → delete (`summarizer.py:120-152`)
- **구조화 출력** — `SceneSummary` 스키마. `response.parsed` 우선, 없으면 `response.text` JSON 파싱, 둘 다 실패 시 `SummaryParseError`
- **후처리** (`summarizer.py:_finalize`) — severity 계산(`_IMPACT_POINTS` + key score), anomaly 정렬(severity → key score → 시작시각 → 축 순서). **`_AXIS_ORDER`는 한글 배열**(`["대사","템포","높낮이","움직임","표정","감정"]`)

### B. `acting-agent` — 코치

`engine.py`(246) · `targeting.py`(284) · `guard.py`(127) · `prompt.py`(192) · `clip.py` · `knowledge.py`.

- `/v2/coach/start`, `/v2/coach/reply` 2개 엔드포인트 (M3에서 미뤄둔 것)
- **`SessionWriteConflict` → 409 `session changed concurrently`** (`coaching.py:189`)
- 낙관적 락은 M3에서 만든 `_save_coach_session` 대응물을 쓴다

### C. `acting-report` — 리포트

`engine.py` · `prompt.py` · 스키마. `POST /v2/reports`는 M3에서 저장 계층이 준비돼 있으므로 LLM 호출부만 연결한다.

### D. 분석 워커

`analysis_worker.py`(258줄) → `@Scheduled` + `ThreadPoolTaskExecutor`.

- lease 획득 → S3 다운로드 → ffmpeg → Gemini → 결과 저장
- **외부 호출을 트랜잭션 안에 넣지 않는다** (`/SPEC.md` §5-4-1). `claim`/`complete`/`fail`/`release` 각각 별도 트랜잭션
- `MAX_EXTERNAL_OPERATION_ATTEMPTS = 3`, lease 만료 sweep, `attempt_count` 상한 처리
- **`run_once()` 동기 훅을 반드시 제공한다** — 하네스가 워커를 결정론적으로 구동하는 유일한 수단이다(M1 참조)
- `sweep`의 객체 삭제는 현재 `DeleteObject` 권한이 없어 조용히 실패 중이다(`docs/archive/SPEC-SOMA-296-s3-instance-role.md` 5장). **현행 동작을 그대로 재현한다** — 권한 문제는 별도 티켓

### E. keepalive

`keepalive.py` — `KEEP_ALIVE_URL`이 있을 때만 주기 핑. `/health`의 `keep_alive` 필드가 이 설정 여부를 반영한다.

## 검증 — 이 사이클만의 추가 관문

하네스는 LLM을 스텁으로 고정하므로 **프롬프트 자체의 동등성은 검증하지 못한다.** 별도로 한다.

**실 Gemini 대조 테스트**:
1. 동일 입력(영상/요약/대화 이력)을 Python과 Java 양쪽에 넣는다
2. 실제 Gemini를 호출한다
3. **구조 동등성**을 본다 — 스키마 준수, 필드 존재, enum 값 범위, 정렬 규칙. 자연어 문장의 완전 일치는 기대하지 않는다
4. 후처리(severity 계산, anomaly 정렬)는 **결정론적이므로 완전 일치**해야 한다

`GEMINI_API_KEY`가 필요하고 비용이 든다. 대조 케이스는 소수로 고정한다.

## 완료 기준 체크리스트

- [ ] `/v2/coach/start`, `/v2/coach/reply` 이식. 409 `session changed concurrently` 재현
- [ ] ffmpeg 압축이 동일 파라미터로 동작. 동시 실행 1개 락, 600초 타임아웃, 폴백 3경로(부재·실패·소용량)
- [ ] Files API 업로드·폴링·삭제. 타임아웃 시 `FileActiveTimeout` 상당
- [ ] 구조화 출력 파싱 2경로(parsed / text) + 실패 시 전용 예외
- [ ] 후처리 결정론적 일치 — severity 계산, anomaly 정렬(한글 축 순서 포함)
- [ ] 워커: lease 획득·만료 sweep·attempt 상한(3)·소유권 검증
- [ ] **`run_once()` 동기 훅 제공**
- [ ] 외부 호출이 트랜잭션 밖에 있다 (커넥션 점유 시간 측정으로 확인)
- [ ] **M1 하네스 전량 통과** (LLM 스텁 고정 상태)
- [ ] **실 Gemini 대조 통과** — 구조 동등 + 후처리 완전 일치
- [ ] `openapi.json` diff 0 (datetime 통일 제외)
- [ ] **파이썬 기능 잔여 0** — 이식되지 않은 기능 목록이 비어 있음을 확인

## 하지 말 것

1. **프롬프트 문구를 개선하지 않는다.** 한 글자도 바꾸지 않고 옮긴다. 출력이 달라진다
2. **후처리 로직을 정리하지 않는다.** severity 임계값·정렬 순서는 계약이다
3. `DeleteObject` 권한 문제를 고치지 않는다 — 현행 동작 재현
4. 기존 `apps/api` 수정 금지
5. 스코프 밖 리팩터링 일체
