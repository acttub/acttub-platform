# SPEC: 리포트(연습 노트) = 결과 + 영상만 제공

기준 커밋: `722626c` · 브랜치: `feat/report-result-video-only`

## 배경 / 목적

현재 리포트 화면(practice-flow, `/home`·`/practice/history`)은 리포트 결과 텍스트에 더해 **코칭 대화(turns) 버블**을 보여주고, 정작 **연습 영상은 없다**. 요구: "리포트에는 리포트 결과와 영상만 제공".

또한 리포트→영상 연결에 필요한 `practice_session_id`가 API 계약에 없어, 현재는 같은 탭에서 코칭을 시작한 경우에만 동작하는 인메모리 맵(`practiceCoachSessionMap`)으로 리포트를 연결하는 임시 구조다(새 탭/새로고침에서 깨짐).

**사용자 확정 사항**:
1. turns는 화면 + `GET /v2/reports` 계약 양쪽에서 제거 (DB `coach_turns` 저장은 유지)
2. `ReportRecord`에 `practice_session_id` 추가, 영상은 `GET /v2/practice-sessions/{id}`의 presign(15분)으로 재생
3. 변경 대상은 practice-flow 리포트 화면만 — `/practice/new`(practice-single) 모달은 무변경
4. 설문 CTA("이번 연습은 어떠셨나요?") 유지. 결과 텍스트 카드(headline·biggest_problem·evidence·self_discovery·next_step)도 현행 유지
5. **연습 세션당 리포트는 1개** (Codex 비판 C3에 대한 사용자 결정: "하나의 연습 세션에서는 코칭 한 번만"). 백엔드가 강제한다 — 리포트가 이미 있는 연습 세션은 재코칭·재리포트 모두 409. 단, **리포트가 없는 미완주 코칭의 재시작은 허용**(코칭 이어하기 API가 없으므로 막으면 사용자가 영구히 갇힘).

## 설계

### 1. 백엔드 — 공유 스키마 (apps/api/acting-report)

- `src/acting_report/schema.py:38-47` `ReportRecord`: `turns` 필드 제거(3행 `CoachTurn` import도 미사용화되므로 제거), `practice_session_id: str = ""` 추가(디폴트는 standalone in-memory 스토어용), docstring 갱신. `_previous_block`(prompt.py:31-42)은 created_at·report만 사용하므로 리포트 생성 무영향(확인 완료).
- `src/acting_report/store.py:50-55` `InMemoryReportStore.add_report`: `turns=session.turns` 제거.
- 테스트: `tests/test_store.py:20` turns 어서션 삭제, `tests/test_app.py:34` `reports[0]["turns"]` 어서션 삭제.

### 2. 백엔드 — acting-api (apps/api/acting-api)

**응답 모델** (`src/acting_api/reports.py`):
- `ReportRecord`(50-54): `turns` 제거, `practice_session_id: UUID` 추가.
- 로컬 `CoachTurn`(45-48) 삭제. [C8] 이로써 미사용이 되는 import(`Literal` 등)도 함께 정리.
- [C4] GET 핸들러(158-167): dict를 그대로 반환하지 않고 **strict `ReportHistoryResponse`로 검증한 뒤 반환** — 공유 스키마 디폴트 `""`가 런타임 응답으로 새는 것을 차단.
- POST 응답 `CreateReportResponse`(57-59) 무변경.

**연습 세션당 리포트 1개 강제** [C3]:
- `db/store.py`: `has_report(session_id)`(1069, coach 세션 기준)를 `has_report_for_practice_session(practice_session_id)`로 교체 — `Report → CoachSession → Summary` 조인으로 `Summary.session_id == practice_session_id` 존재 검사.
- `reports.py` POST(116): `store.has_report(req.session_id)` → `store.has_report_for_practice_session(owned.practice_session_id)` (claim 내부 검사 유지 — 동시성 직렬화 지점). 409 detail은 기존 "report already exists for session" 유지.
- `coaching.py` `coach_start`(65-124): 소유권 확인 직후·begin_sync_operation 이전에 `has_report_for_practice_session(owned.practice_session_id)` 검사, 있으면 409 detail "report already exists for practice session". (경합으로 코칭이 하나 더 생겨도 리포트 생성 단계에서 최종 차단되므로 pre-claim 검사로 충분)
- `complete_report_operation`의 None 페이로드 폴백(reports.py:137-142, coach 세션 unique 기반)은 그대로 유지.

**list_reports** (`db/store.py:1100-1144`):
- [C2] `db.scalars(...)` → `db.execute(select(DbReport, PracticeSession.id).join(...)...)`로 바꾸고 **(report, practice_session_id) 튜플을 명시적으로 구조분해**. order_by(1109)·user 필터(1108) 유지.
- turns 적재 블록(1112-1122) 삭제. `ReportRecord` 조립에서 `turns=` 제거·`practice_session_id=str(...)` 추가.
- 49행 `ReportCoachTurn` import는 1799행에서 계속 사용 — 유지. DB 마이그레이션 없음.

**테스트**:
- `tests/platform_test_support.py`: FakeStore `has_report`(766)를 `has_report_for_practice_session`으로 교체(coach_sessions·summaries 경유 검사), 753-758 `ReportRecord` 조립을 새 모양으로(context.practice_session_id 사용, 666행에 존재).
- `tests/test_coach_reports_v2.py:260-264`: turns 어서션 → `"turns" not in record` + `practice_session_id` 일치 검증. **추가**: (a) 리포트가 있는 연습 세션에 `POST /v2/coach/start` → 409, (b) 같은 연습 세션의 다른 코치 세션으로 `POST /v2/reports` → 409.
- `tests/test_response_contracts.py`: [C1] `RESPONSE_COMPONENT_SHAPES`에서 `CoachTurn`(93) 제거, `ReportRecord` required set(160)을 `{"created_at", "session_id", "practice_session_id", "report"}`로 교체.
- `tests/test_db_store.py:661-663`: turns 길이 어서션 → `practice_session_id` 어서션. **추가**: `has_report_for_practice_session` 동작 검사.

### 3. 계약 산출물 (한 PR, apps/api에서)

1. `uv run --package acting-report pytest && uv run --package acting-api pytest`
2. `spec/openapi.json` 재생성(apps/api/CLAUDE.md의 명령) → [C1] 예상 diff는 **`ReportRecord` 변경 + `CoachTurn` 컴포넌트 삭제** 두 가지뿐인지 확인
3. `API.md`의 GET /v2/reports 응답 예시 갱신(305행 부근) + 409 정책(연습 세션당 리포트 1개) 언급
4. `pnpm --filter web generate:v2-schema` (v2-schema.d.ts에서도 CoachTurn 컴포넌트가 사라짐)

### 4. 프론트 — apps/web/src/features/practice/practice-flow.tsx (이 파일만)

**turns 제거**: `normalizeReportTurns`(69-77)·`reportTurnsForStorage`(79-84)·`reportTurns` state(99)와 set 호출 5곳(215, 271, 371, 435, 485)·SessionView `reportTurns` prop(573, 1207, 1225)·Report `turns` prop(1284, 1576, 1581)·코칭 대화 섹션(1616-1626) 삭제. [C8] 이로써 미사용이 되는 `localTurns`(475) 등 잔재도 삭제. **`ConversationBubble`(1557-1572)은 유지** — 라이브 코칭 화면 1499행에서 사용 중(확인 완료).

**리포트 연결 resolver** [C3·C7]: `practiceCoachSessionMap`(51-52, 368, 393, 543) 삭제. `linkedReportForSession`(190-197)·`showReportRecord`의 ordinal 계산(210-214)을 **단일 resolver로 통합**: `practice_session_id`를 받아 `{record, ordinal}`을 반환. 매칭은 `record.practice_session_id === practiceSessionId`로 하되, 과거 중복 데이터 방어로 **여러 개면 가장 최신(배열 마지막) 선택**. ordinal은 기존 의미 유지(전체 리포트 목록에서의 index+1). `createActingReport`의 409 복구 경로(503-510)도 coach session id 매칭 → practice_session_id 매칭으로 변경(active.sessionId 사용).

**영상 추가**: 리포트는 항상 SessionView 안에서 렌더되고 `sessionDetail.playback_url`이 이미 로드돼 있다(이전 기록 경로는 openSession→getPracticeSession이 방금 발급한 presign — 추가 API 호출 불필요). 1284행에서 `playbackUrl={session.playback_url}`·`onPlaybackError` 전달, Report의 reportData 존재 분기에서 헤더 카드 다음에 SummaryView 1377과 동일 패턴의 `<video key={playbackUrl} controls preload="metadata" src={playbackUrl} onError={onPlaybackError}>` 카드 추가. reportData null 분기(연습 노트 만들기 프롬프트)는 영상 없이 현행 유지.

**presign 만료 처리** [C6 부분 수용]: one-shot 가드 `playbackRefreshAttemptedRef`(114)를 리포트 진입 시 재장전 — `showReportRecord`와 `createActingReport` 성공 경로에서 `false`로 리셋. 만료 시 기존 `refreshPlayback`(529-539)이 1회 재발급. **2차 실패(재발급 후에도 onError, 또는 재발급 호출 실패) 시 조용히 무시하지 않고 `setError`로 ErrorNotice 안내** — 리포트 텍스트는 유지(전체 실패 금지). 정상 재생 후 가드 재장전(30분+ 장기 체류 재만료 대응)은 스코프 밖 — 기각.

**로컬 ReportRecord 조립**(`createActingReport` 473-527): 가드를 `if (!coach || !active) return;`로 확장, localRecord(487-492)에서 `turns` 제거·`practice_session_id: active.sessionId` 추가.

카피는 한국어 존댓말("~해요") — video fallback·오류 안내는 기존 "분석한 영상을 재생할 수 없어요." 톤 준수(product-language-guard 통과 필요).

## 검증

1. 백엔드: `cd apps/api && uv run --package acting-report pytest && uv run --package acting-api pytest`
2. 웹: `pnpm --filter web typecheck` · `pnpm --filter web lint` · `pnpm --filter web test` · `pnpm --filter web build` (typecheck가 turns 잔재 전수 검출)
3. 수동(개발 루프: api :8000 + `pnpm dev`): (a) 새 연습→코칭→연습 노트에 영상+결과+설문만 표시 (b) 새 탭에서 `/practice/history`의 완료 연습 열기 → 리포트 자동 표시·완료 배지 (c) 영상 onError 시 재발급 재생 (d) `/practice/new` 모달 무변경 (e) 리포트 있는 세션에 coach/start 재호출 → 409

## 완료 기준 체크리스트

- [ ] GET /v2/reports 각 record: `turns` 없음, `practice_session_id`(UUID) 있음 — openapi.json·계약 테스트 반영, GET 핸들러가 strict 모델로 런타임 검증
- [ ] openapi.json diff = ReportRecord 변경 + CoachTurn 컴포넌트 삭제뿐
- [ ] POST /v2/reports 요청·응답 계약 무변경, 연습 세션당 리포트 1개 강제(409) — 다른 코치 세션 경유 중복 생성 차단
- [ ] 리포트가 있는 연습 세션에 POST /v2/coach/start → 409, 리포트 없는 미완주 코칭 재시작은 허용
- [ ] coach_turns 테이블·저장 경로 무변경(마이그레이션 없음), `list_reports`는 coach_turns 미조회
- [ ] 리포트 생성 프롬프트(previous 블록) 회귀 없음 — acting-report 테스트 green
- [ ] 리포트 화면 = 결과 텍스트 카드 + 영상 + 설문 CTA (코칭 대화 섹션 없음)
- [ ] 새 탭/새로고침 포함, 완료 연습 열기 시 리포트 즉시 표시 (practiceCoachSessionMap 제거, 단일 resolver)
- [ ] 방금 연습 경로에서도 리포트에 영상 표시, presign 만료 시 1회 재발급, 2차 실패 시 오류 안내 + 텍스트 유지
- [ ] `/practice/new` 리포트 모달 무변경
- [ ] pytest 2종·웹 4종 명령 전부 통과, 계약 산출물(openapi.json·API.md·v2-schema.d.ts) 동일 PR 포함

## 하지 말 것 (스코프 제한)

- `v2-schema.d.ts` 직접 수정 금지(재생성만), 다른 lockfile 추가 금지
- encouragement/comparison 화면 추가, Report/Summary 컴포넌트 통합 등 스코프 밖 리팩터링 금지
- practice-single.tsx 수정 금지
- DB 마이그레이션·coach_turns 저장 경로 변경 금지
- 코칭 이어하기(resume) API 신설 금지 — 이번 스코프 밖

## Codex 설계 비판 반영 기록 (Phase 2)

- C1(BLOCKER) 수용: CoachTurn 컴포넌트 삭제를 계약 테스트·예상 diff에 반영
- C2(BLOCKER) 수용: list_reports를 db.execute + 튜플 구조분해로 명시
- C3(BLOCKER) 수용(사용자 결정): 연습 세션당 리포트 1개를 백엔드 강제 + 프론트 최신 우선 방어
- C4(EDGE) 수용: GET 핸들러에서 strict 응답 검증
- C5(EDGE) 기각(사용자 결정): 스토리지 장애 시 세션 상세 503은 기존 동작 — playback_url nullable화는 별도 과제(미결)
- C6(EDGE) 부분 수용(사용자 결정): 2차 실패 시 오류 표시. 정상 재생 후 가드 재장전은 기각
- C7(SIMPLER) 수용: 연결·ordinal 단일 resolver
- C8(NIT) 수용: 미사용 import·localTurns 잔재 삭제

## 미결 사항

- 세션 삭제(소프트 삭제) 시 리포트 노출 정책 — 현재 삭제 UI가 없어 이번 스코프에서 제외
- playback_url nullable화(스토리지 장애 시에도 리포트 텍스트 표시) — 별도 과제 [C5]
