# SPEC — 이전 기록 API 개편 (리포트 상세 신설 + 목록 슬림화)

기준 커밋: `5155dc0`(dev) · 브랜치: `feat/report-history-api`

## 배경 / 목적

"이전 기록"은 완료된 연습(리포트)을 영상과 함께 다시 보는 화면이다. 현재는
`GET /v2/reports`가 **리포트 본문 전체**를 목록으로 실어 나르고, 웹·모바일 상세
화면이 그 목록 레코드의 본문을 그대로 렌더링한다(추가 호출 없음). 영상은 웹에서만
`GET /v2/practice-sessions/{id}`로 따로 받는다.

이 구조의 문제:
1. 목록 응답이 리포트 수에 비례해 무거워진다(본문 7필드 × N).
2. `GET /v2/reports`가 `hidden_at`(사용자 삭제=소프트 숨김)을 필터링하지 않아,
   **삭제한 연습의 리포트가 모바일 기록 화면에 계속 노출된다**(실사용 버그).
3. 영상과 리포트를 얻는 호출이 분리돼 웹 상세가 2-call이다.

목표: 목록은 "클릭할 항목 나열"로 슬림화하고, 상세는 리포트 본문+영상 URL을 한 번에
주는 전용 엔드포인트로 분리한다. hidden 필터를 API 전체에 일관 적용한다.

## 설계

### 백엔드 (`apps/api/acting-api`)

**A. 신설 `GET /v2/reports/{practice_session_id}`**
- 응답 200 (`_StrictResponse`, extra 금지):
  ```
  { practice_session_id: UUID, created_at: datetime,
    report: ActingReport, playback_url: str }
  ```
- path key는 `practice_session_id`. 조회는 `reports → coach_sessions → summaries →
  practice_sessions` 조인으로 역추적하며 `PracticeSession.user_id == user.id` AND
  `PracticeSession.hidden_at IS NULL` 필터.
- 미존재 / 남의 리소스 / hidden / 리포트 없음 → **404 `report_not_found`** (구분 안 함,
  기존 관례).
- `playback_url`은 upload_intents.object_key로 presign (`storage.presign_playback`,
  TTL `PLAYBACK_URL_TTL_SEC=15분` 재사용). storage 미설정 → **503**
  `storage_not_configured` (기존 세션 상세와 동일).
- 응답에 `session_id`(coach_session id)·`turns` **미포함**.
- store: `get_report_detail_for_practice_session(user_id, practice_session_id)` 신설 —
  리포트 본문 + upload object_key를 함께 반환(1 쿼리). presign은 라우터에서.

**B. `GET /v2/reports` 슬림화 + hidden 필터**
- `ReportRecord`를 `{ practice_session_id: UUID, headline: str,
  created_at: datetime }`로 축소. `session_id`·`report`(본문) 제거.
- `ReportHistoryResponse = { count, reports: [슬림] }` 유지.
- `store.list_reports`에 `PracticeSession.hidden_at IS NULL` 필터 추가. 반환은
  슬림 필드만(headline만 필요 — 본문 로딩 불필요).

**C. 스펙·타입 재생성 (같은 PR)**
- `spec/openapi.json` 재생성 → 웹 `v2-schema.d.ts` 재생성.

### 웹 프론트 (`apps/web`)

목록 레코드 본문에 의존하던 **세 경로**를 fetch 기반으로 전환:
- **신설** `getReport(practiceSessionId)` API 클라이언트 (`lib/api/v2/reports.ts`).
- **기록 열기**: `showReportRecord`가 목록에서 본문을 꺼내던 것 → `getReport` fetch로
  `reportData`(본문)+`playbackUrl`을 한 번에 세팅. **로딩/에러 상태 신설**.
- **리포트 생성 직후**(`POST /v2/reports` 후): 슬림 목록 재파생 대신 **POST 응답 본문**을
  직접 `reportData`에 사용해 즉시 표시.
- **playback refresh**(`onPlaybackError`/`playbackRefreshAttemptedRef`): 만료 시
  `getReport` 재호출로 재발급.
- 목록 화면은 `listPracticeSessions`(진행 중 표시용)+슬림 `listReports` **병행 유지**.
  리포트 카드 미리보기는 `headline`만 사용.

### 모바일 (`apps/mobile`, 수기 타입 — 웹 타입 재생성과 독립)

- `lib/api.ts` `ReportRecord`를 슬림(`practice_session_id, headline, created_at`)으로
  수정, 죽은 `turns` 필드 제거. `getReport(practiceSessionId)` 추가.
- `history.tsx`: 카드를 **날짜+headline**만으로 단순화(기존
  `biggest_problem.description`·`next_step` 미리보기 제거). 카드 key를
  `practice_session_id + created_at`로 변경(응답에서 session_id 제거되므로).
- `report-detail.tsx`: 목록이 넘긴 본문(module store) 대신 **`getReport`로 본문 fetch**
  (로딩 상태). 삭제를 `deletePracticeSession(practice_session_id)`로 수정 — 현재
  `session_id`(coach id) 전달은 잠재 버그였음.
- 모바일 기록은 리포트 전용이라 진행 중 세션 관련 변경 없음.

## 완료 기준 체크리스트

- [ ] `GET /v2/reports/{practice_session_id}` 200이 명세대로(4필드, session_id/turns 없음).
- [ ] 같은 엔드포인트가 hidden 세션엔 404, 남의 리소스엔 404, storage 미설정 시 503.
- [ ] `GET /v2/reports`가 슬림 3필드만 반환하고 hidden 세션 리포트를 제외.
- [ ] `store.list_reports` hidden 필터 + 신설 상세 store 함수에 pytest 커버리지 추가.
- [ ] `spec/openapi.json`·`v2-schema.d.ts` 재생성 반영.
- [ ] 웹: 기록 열기/생성 직후/playback 만료 세 경로가 fetch 기반으로 동작, 로딩·에러 표시.
- [ ] 웹 `pnpm lint`·`typecheck`·`--filter web test`·`build` 통과.
- [ ] 모바일: 카드 슬림화, 상세 fetch, 삭제 practice_session_id 사용, `turns` 제거,
      모바일 typecheck 통과.
- [ ] `apps/api` pytest 전체 통과.

## 하지 말 것 (스코프 제한)

- 폴링 경량 API(`/status`), `filter=incomplete`, 리포트 삭제 API, DB 스키마 변경 — 전부
  이번 스코프 밖(TODO에 이미 기록).
- 리포트 생성 로직(`POST /v2/reports`)·코칭 플로우·업로드/세션 생성 계약 변경 금지.
- 리포트 본문 필드 구조(ActingReport) 변경 금지 — 위치만 이동, 재정의 안 함.
- 스코프 밖 리팩터링·파일 정리 금지.

## 미결 사항

- 없음(설계 합의 완료). 구현 중 발견 사항은 SPEC 기준으로 판정.

## 실행 환경 / 병렬 전략 (Codex 위임)

- 작업 위치: git worktree `/Users/insung/Documents/GitHub/acttub/wt-report-history`
  (브랜치 `feat/report-history-api`, dev=5155dc0 위로 rebase 완료). 메인 체크아웃은
  다른 세션이 `feat/signup-consent`로 점유 중이라 격리함.
- 의존성: 백엔드(계약·타입 소스) → 웹 타입 재생성 → 웹 프론트. 모바일은 수기 타입이라
  계약만 고정되면 독립.
- **Wave 1 (순차, 단독)**: 백엔드 A+B+C → pytest 검증 → 커밋.
- **Wave 2 (병렬, 경로 分離: apps/web vs apps/mobile)**: 웹 프론트 3경로 리팩터 //
  모바일 리팩터. 각자 검증(web lint/typecheck/test/build, mobile typecheck) → 커밋.
- 결과 보장: 각 wave 후 실행 검증 + Claude 리뷰(triage) + Codex 최종 이중 리뷰.
- BASE_REF(전체 PR diff 기준) = 5155dc0(dev tip). pre-work(UNIQUE·ERD)는 커밋 완료.
