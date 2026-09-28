# challenge.ai-report AI 리포트

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 결정 기록: ADR-005(개정 2026-09-21)
- 화면: A18.1·A18.2(안내 문구), A18.3("AI 리포트 받기"), 리포트 화면(없음, 디자인에 반영할 것), P03
- 테이블: entry_ai_reports, ai_jobs, challenge_entries

## 기능
참여자가 "AI 리포트 받기"를 누르면 같은 챌린지의 다른 사람 공개 참여작을 표본으로 두고 내 영상의 관찰과 표현 차이를 설명하는 리포트를
뒤에서 만들어 본인에게만 보여 준다. 공개·비공개 참여작 모두 요청할 수 있다.

## 의도
"같은 대사 영상들과 비교한 AI 리포트"(A18.1)는 랭킹과 달리 사람의 반응이 아니라 관찰이다. 채점 금지(ADR-005)에 따라 점수·순위·우열·등급·
재능·합격 가능성을 내지 않고, 내 영상에서 확인된 것(발화·멈춤·시선·동작)과 다른 영상들에서 자주 보인 선택을 근거 구간과 함께 견준다.
비용을 위해 자동 생성이 아니라 요청 시 생성하고 표본 수를 제한한다. 연습 노트(practice.note)와 다른 것이고 전후 영상 비교(ADR-007 후속)도
아니다.

## 목적
배우가 같은 대사를 남들은 어떻게 했는지, 내 것은 무엇이 다른지 관찰로 본다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/entries/{id}/ai-report` | `ChallengeAiReportRequest`(request_id) | `ChallengeAiReport` 202(새 생성·생성 중), 200(결과 있음) | `member_only` 403, `entry_not_found` 404, `video_not_ready` 422, `request_fingerprint_mismatch` 422, `daily_report_request_limit` 429 |
| `GET /v2/entries/{id}/ai-report` | id | `ChallengeAiReport` 200 | `member_only` 403, `ai_report_not_found` 404 |
| `ChallengeReportScheduler.poll` → `ChallengeReportWorker.runOnce` (`CHALLENGE_REPORT_POLL_INTERVAL_MS`, 기본 5초, 스위치 `ANALYSIS_WORKER_ENABLED`) | `ai_jobs` kind challenge_report 대기 작업 | entry_ai_reports ready, entry_ai_report_ready 알림 | 실행 실패·거절 출력은 재큐, 세 번째 실패면 failed. 참여작 삭제·탈퇴면 저장하지 않고 작업 cancelled |
| 보관 기간 정리 (`ChallengeSettlementScheduler.run` 안, 매시) | purged_at이 90일 지난 행 | 행 삭제 | — |

## 상태
entry_ai_reports.status와 파기 표시(purged_at).

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| pending | 새 생성 요청(행 없음, 또는 failed 뒤 "다시 시도" — 같은 행에 새 job_id, attempt_count 0, result 비움) | challenge.ai-report |
| ready | 워커 저장 성공(리포트가 이 생성의 것이고 참여작·계정이 살아 있음) | challenge.ai-report |
| failed | 세 번째 실행 실패(attempt_count 3) | challenge.ai-report |
| 파기(purged_at, result NULL) | 참여작 삭제. 탈퇴 | challenge.entry, account.withdraw |

- 불변 조건: 참여작당 한 행(`uq_entry_ai_reports_entry`). attempt_count 0~3(`ck_entry_ai_reports_attempts`). ready면 result가 있거나 파기됨
  (`ck_entry_ai_reports_ready`). 파기면 result NULL(`ck_entry_ai_reports_purged`). 파기는 status를 바꾸지 않는다.
- 끝 상태: ready(다시 요청해도 기존 결과). failed는 "다시 시도"로 pending이 된다. 파기된 행은 90일 뒤 지운다.

## 규칙·제약
- 생성은 "AI 리포트 받기"를 눌렀을 때 ai_jobs(kind challenge_report) 하나를 만든다. 결과가 이미 있으면 기존 결과를 연다(참여작과 1:1). 참여작당
  실행 중인 생성은 하나이고 같은 요청 id의 재전송은 기존 작업을 돌려준다. 회원은 하루 3회의 새 생성이고 넘으면 429 daily_report_request_limit.
  한 생성 안에서 자동 재시도와 금지 어휘 재생성을 합쳐 최대 3번 실행하고, 소진하면 failed다. 그 뒤 "다시 시도"는 새 생성이라 하루 한도를 쓴다.
- 표본은 같은 챌린지 안 서로 다른 다른 작성자의 공개 조건 참여작(파일 있음) 가운데 published_at 최근 5개다(작성자당 하나, 좋아요 수는 기준이
  아니다). 요청자와 차단 관계인 작성자의 참여작은 뺀다. 비공개 참여작은 표본이 되지 않는다. 공개 참여는 표본 활용 허용을 뜻하고 올리기 화면·
  처리방침에 그 사실을 적는다. 표본이 3개 미만이면 내 영상의 관찰만 만들고 "비교할 영상이 아직 부족해요"를 쓴다. 요청 시점에 참여작의 영상
  파일이 파기됐으면 422 video_not_ready.
- 입력은 영상과 챌린지 대사만이다. 받아쓰기 대신 모델이 영상의 소리를 직접 듣는다(`ChallengeReportModel`). 코치 대화·장면 입력·배우 기억은 쓰지 않는다. 표본은 리포트에 이름·id 없이 "다른 참여작들"로만
  나온다.
- 결과는 관찰(내 영상에서 확인된 것, 근거 구간), 견주기(표본에서 자주 보인 선택과 내 선택의 차이, 우열 없이), 한계(못 본 구간·표본 부족),
  다음 시도 제안 하나(없을 수 있음)이다. 점수·백분위·등급·순위·"잘했어요"·재능 판정이 들어간 출력은 저장 전에 거절하고 다시 만든다.
  언어는 앱 표시 언어(한국어 사용자 전용이라 한국어).
- entry_ai_reports는 참여작당 한 행이고 status(pending·ready·failed), model, format_version, attempt_count, result(jsonb: 관찰·한계·제안과 견주기
  문장마다 근거 표본 참여작 id — 내부 전용), requested_at, completed_at을 가진다. 저장 직전과 조회 때 표본 선정 조건 전체(공개 조건·파일 있음·
  차단 관계·다른 작성자)를 다시 검사해, 부적격이 된 표본에 기댄 견주기 문장은 응답에서 뺀다. 표본 id는 사용자 응답에 넣지 않는다.
- 실패는 practice.analyze와 달리 즉시 실패 분류가 없다. 모델 호출 실패와 쓸 수 없는 출력(모양·금지 어휘로 거절된 파싱)은 모두 바깥 의존
  실패로 보고, 세 번째 시도 전까지는 재큐하고 세 번째 실패에서 failed로 닫는다(`ChallengeReportWorker`, `ChallengeReportRules.MAX_RUNS`). 저장 직전에 계정·
  참여작·표본 권한을 다시 확인하고 탈퇴·삭제가 먼저 끝났으면 저장하지 않는다.
- 본인만 본다. 남의 리포트 id는 404. 비공개 참여작의 리포트도 본인은 본다. 참여작을 지우면 본문·비교 자료를 파기한다. 탈퇴하면 본문·비교 자료를
  파기하고 생성 이력(요청·완료 시각, 상태)만 탈퇴일부터 90일 남긴다.
- 하루 참여 3개 + 새 생성 3회 + 생성당 실행 3번이 비용의 상한이다.

## 예외
- 표본 0~2개: 관찰만, 안내 문구. 표본이 있어도 못 본 구간이 있으면 한계에 적고 채우지 않는다.
- 생성 중 참여작 삭제: 작업 취소, 리포트 없음. 생성 중 요청자 탈퇴: 저장하지 않는다.
- 실행 3번 소진: failed. "다시 시도": 새 생성(하루 한도 소비). 같은 참여작에 동시 요청 둘: 작업 하나.
- 하루 4번째 새 생성: 429 daily_report_request_limit. 파일 파기한 참여작 요청: 422 video_not_ready.
- 결과에 금지 어휘: 저장하지 않고 재생성(실행 수에 포함), 소진하면 failed.

## 검증 방법
- 적격 표본 5개 이상인 챌린지에서 공개 참여작 등록 뒤 "AI 리포트 받기": ai_jobs challenge_report 1행, 완료 뒤 entry_ai_reports 1행(status ready).
  결과에 관찰(근거 구간)·견주기·한계·제안이 있고 점수·등급·순위·백분위·칭찬·재능 문구가 없다. 다시 누름: 새 작업 없이 기존 결과.
- 비공개 참여작 요청: 같이 되고 본인이 본다. 등록만 하고 요청 안 함: ai_jobs 없음.
- 적격 표본 12개(작성자 8명): 서로 다른 작성자의 최근 5개만 입력이고 사용자 응답에 다른 사람 이름·id가 없다(DB 결과에는 문장별 표본 id가 있다).
  적격 표본 2개: 관찰만과 "비교할 영상이 아직 부족해요". 표본 후보에 비공개 참여작·파일 파기 영상·나와 차단 관계인 작성자·내 다른 참여작: 들어가지
  않는다.
- 하루 4번째 새 생성: 429. 같은 요청 id 재전송: 기존 작업, 한도 그대로. 같은 참여작에 다른 요청 id로 동시 요청: 작업 하나.
- 실행 3번 실패: failed, attempt_count 3. "다시 시도": 새 ai_jobs 1행, 하루 한도 1 소비. 금지 어휘 출력 주입: 저장되지 않고 재생성으로 실행 수 +1.
- 표본이었던 참여작이 비공개·삭제·신고 숨김으로 바뀌거나 그 작성자가 탈퇴·나를 차단한 뒤 조회: 그 표본에 기댄 견주기 문장이 없다. 표본 챌린지가
  review: 같다.
- 파일만 파기한 참여작 요청: 422 video_not_ready. 못 본 구간이 있는 영상: 한계에 적히고 채워지지 않는다.
- 참여작 삭제: entry_ai_reports 본문 없음, 진행 중 작업 취소. 탈퇴: 본문 없음, 이력만 남고 91일 뒤 없음. 남의 리포트 조회: 404.
- 입력 조립에 코치 대화·장면 입력·배우 기억이 없다(단위 테스트).

## 범위 밖
- 점수·등급·순위 같은 평가(ADR-005, [PRD](../../PRD.md) 「지금 하지 않는 것」).
- 전후 영상 비교(ADR-007).
- 참여 때 자동 생성.
- 코치 대화·장면 입력·배우 기억을 입력으로 쓰는 것.
