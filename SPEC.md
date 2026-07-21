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

## 설계

### 1. 백엔드 — 공유 스키마 (apps/api/acting-report)

- `src/acting_report/schema.py:38-47` `ReportRecord`: `turns` 필드 제거(3행 `CoachTurn` import도 미사용화되므로 제거), `practice_session_id: str = ""` 추가(디폴트는 standalone in-memory 스토어용 — 실계약은 acting-api strict 모델이 required UUID로 강제), docstring 갱신. `_previous_block`(prompt.py:31-42)은 created_at·report만 사용하므로 리포트 생성 무영향(확인 완료).
- `src/acting_report/store.py:50-55` `InMemoryReportStore.add_report`: `turns=session.turns` 제거.
- 테스트: `tests/test_store.py:20` turns 어서션 삭제, `tests/test_app.py:34` `reports[0]["turns"]` 어서션 삭제.

### 2. 백엔드 — acting-api (apps/api/acting-api)

- `src/acting_api/reports.py`: 응답 모델 `ReportRecord`(50-54)에서 `turns` 제거·`practice_session_id: UUID` 추가, 로컬 `CoachTurn`(45-48) 삭제(이 파일 전용 확인 완료). POST 경로·`CreateReportResponse`·GET 핸들러 코드는 무변경.
- `src/acting_api/db/store.py` `list_reports`(1100-1144): select를 `(DbReport, PracticeSession.id)` 튜플로 바꿔 기존 4중 조인에서 practice session id를 함께 조회(order_by 1109·user 필터 1108 유지), turns 적재 블록(1112-1122) 삭제, `ReportRecord` 조립에서 `turns=` 제거·`practice_session_id=str(...)` 추가. 49행 `ReportCoachTurn` import는 1799행에서 계속 사용 — 유지. DB 마이그레이션 없음.
- 테스트: `tests/platform_test_support.py:753-758` FakeStore 조립을 새 모양으로(context.practice_session_id 사용, 666행에 존재), `tests/test_coach_reports_v2.py:260-264` turns 어서션 → `"turns" not in record` + `practice_session_id` 일치 검증, `tests/test_response_contracts.py:160` required set 교체, `tests/test_db_store.py:661-663` turns 길이 어서션 → practice_session_id 어서션.

### 3. 계약 산출물 (한 PR, apps/api에서)

1. `uv run --package acting-report pytest && uv run --package acting-api pytest`
2. `spec/openapi.json` 재생성(apps/api/CLAUDE.md의 명령) → diff가 ReportRecord 변경뿐인지 확인
3. `API.md`의 GET /v2/reports 응답 예시 갱신(305행 부근)
4. `pnpm --filter web generate:v2-schema`

### 4. 프론트 — apps/web/src/features/practice/practice-flow.tsx (이 파일만)

**turns 제거**: `normalizeReportTurns`(69-77)·`reportTurnsForStorage`(79-84)·`reportTurns` state(99)와 set 호출 5곳(215, 271, 371, 435, 485)·SessionView `reportTurns` prop(573, 1207, 1225)·Report `turns` prop(1284, 1576, 1581)·코칭 대화 섹션(1616-1626) 삭제. **`ConversationBubble`(1557-1572)은 유지** — 라이브 코칭 화면 1499행에서 사용 중(확인 완료).

**practiceCoachSessionMap 제거**: 맵 선언·주석(51-52)·set 2곳(368, 393)·clear(543) 삭제. `linkedReportForSession`(190-197)을 `sourceReports.find((r) => r.practice_session_id === practiceSessionId)`로 교체. 부수 효과로 새 탭/새로고침에서도 기록 카드 "완료" 배지·리포트 자동 표시가 동작하게 됨.

**영상 추가**: 리포트는 항상 SessionView 안에서 렌더되고 `sessionDetail.playback_url`이 이미 로드돼 있다(이전 기록 경로는 openSession→getPracticeSession이 방금 발급한 presign — 추가 API 호출 불필요). 1284행에서 `playbackUrl={session.playback_url}`·`onPlaybackError` 전달, Report의 reportData 존재 분기에서 헤더 카드 다음에 SummaryView 1377과 동일 패턴의 `<video key={playbackUrl} controls preload="metadata" src={playbackUrl} onError={onPlaybackError}>` 카드 추가. reportData null 분기(연습 노트 만들기 프롬프트)는 영상 없이 현행 유지.

**presign 만료 처리**: one-shot 가드 `playbackRefreshAttemptedRef`(114)를 리포트 진입 시 재장전 — `showReportRecord`(210-217)와 `createActingReport` 성공 경로(486 부근)에서 `false`로 리셋. 만료 시 기존 `refreshPlayback`(529-539)이 1회 재발급, 실패 시 ErrorNotice만 표시하고 리포트 텍스트는 유지(전체 실패 금지).

**로컬 ReportRecord 조립**(`createActingReport` 473-527): 가드를 `if (!coach || !active) return;`로 확장, localRecord(487-492)에서 `turns` 제거·`practice_session_id: active.sessionId` 추가. 409 복구 경로(503-510)는 무수정.

카피는 한국어 존댓말("~해요") — video fallback은 기존 "분석한 영상을 재생할 수 없어요." 톤 준수(product-language-guard 통과 필요).

## 검증

1. 백엔드: `cd apps/api && uv run --package acting-report pytest && uv run --package acting-api pytest`
2. 웹: `pnpm --filter web typecheck` · `pnpm --filter web lint` · `pnpm --filter web test` · `pnpm --filter web build` (typecheck가 turns 잔재 전수 검출)
3. 수동(개발 루프: api :8000 + `pnpm dev`): (a) 새 연습→코칭→연습 노트에 영상+결과+설문만 표시 (b) 새 탭에서 `/practice/history`의 완료 연습 열기 → 리포트 자동 표시·완료 배지 (c) 영상 onError 시 재발급 재생 (d) `/practice/new` 모달 무변경

## 완료 기준 체크리스트

- [ ] GET /v2/reports 각 record: `turns` 없음, `practice_session_id`(UUID) 있음 — openapi.json·계약 테스트 반영
- [ ] POST /v2/reports 요청·응답 계약 무변경
- [ ] coach_turns 테이블·저장 경로 무변경(마이그레이션 없음), `list_reports`는 coach_turns 미조회
- [ ] 리포트 생성 프롬프트(previous 블록) 회귀 없음 — acting-report 테스트 green
- [ ] 리포트 화면 = 결과 텍스트 카드 + 영상 + 설문 CTA (코칭 대화 섹션 없음)
- [ ] 새 탭/새로고침 포함, 완료 연습 열기 시 리포트 즉시 표시 (practiceCoachSessionMap 제거)
- [ ] 방금 연습 경로에서도 리포트에 영상 표시, presign 만료 시 1회 재발급·실패 시 텍스트 유지
- [ ] `/practice/new` 리포트 모달 무변경
- [ ] pytest 2종·웹 4종 명령 전부 통과, 계약 산출물(openapi.json·API.md·v2-schema.d.ts) 동일 PR 포함

## 하지 말 것 (스코프 제한)

- `v2-schema.d.ts` 직접 수정 금지(재생성만), 다른 lockfile 추가 금지
- encouragement/comparison 화면 추가, Report/Summary 컴포넌트 통합 등 스코프 밖 리팩터링 금지
- practice-single.tsx 수정 금지
- DB 마이그레이션·coach_turns 저장 경로 변경 금지

## 미결 사항

- 세션 삭제(소프트 삭제) 시 리포트 노출 정책 — 현재 삭제 UI가 없어 이번 스코프에서 제외 (숨긴 세션은 히스토리에 안 보이므로 리포트 진입 경로도 없음)
