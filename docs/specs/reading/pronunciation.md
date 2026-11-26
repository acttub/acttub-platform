# reading.pronunciation 발음 보고서

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-606 (Pro 혜택은 SOMA-818, 기다려 주기·완료 알림은 SOMA-1169)
- 화면: 리딩 끝 화면의 발음 보고서(앱 `app/reading/pronunciation.tsx`, 웹 `features/reading/screens/PronunciationReportScreen.tsx`)
- 테이블: reading_pronunciation_reports

## 기능
끝낸 리딩 회차의 녹음을 발음 채점 서비스(`apps/pron`)로 보내 줄마다 잘못 들린 말과 자주 나온 발음 버릇을 모은 보고서를 만든다.
Pro 혜택이다. 서버 스위치를 켠 서버에서만 돈다(실험, OpenAPI 에 싣지 않는다).

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/reading/sessions/{session_id}/pronunciation` | 헤더 `Authorization`(게이트 통과) | `{status, report, progress}` 200. `status` 는 아래 「상태」의 값이고, `report` 는 done·skipped 일 때만 `{summary, misheard, habit, skippedLines, lines, skippedReasons}`, 그 밖은 null. `progress` 는 아래 「채점 진행」 | 스위치가 꺼졌거나 Pro·허용 사용자가 아님 404 `pronunciation_not_available`, 남의 회차·없는 회차 404 `session_not_found` |
| `PronunciationWorkerScheduler`(`PRON_REPORT_POLL_MS`, 기본 5초) | queued 보고서, 임대가 지난 running 보고서 | 채점 뒤 done·skipped 저장, 실패면 다시 queued 또는 failed. 오래 걸린 done 은 주인에게 푸시(아래) | 시도 3번 소진이면 failed |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| not_ready(응답에만, 행 없음) | 회차가 completed 가 아님 | reading.pronunciation |
| queued | 끝난 회차를 처음 조회함(행을 만든다). 시도가 남은 실패 | reading.pronunciation |
| running | 일꾼이 집음(시도 수 +1, 임대 `PRON_REPORT_LEASE_SECONDS` 기본 600초). 임대가 지난 running 을 다시 집음 | reading.pronunciation |
| done | 채점한 줄이 하나 이상이라 보고서가 비지 않음 | reading.pronunciation |
| skipped | 쓸 줄이 없음(받아쓴 글이 없거나, 너무 길거나, 대본과 다르게 읽은 줄뿐) | reading.pronunciation |
| failed | 시도 3번(`PRON_REPORT_MAX_ATTEMPTS`)을 다 쓴 실패, 또는 시도를 다 쓴 채 임대가 지남(`failure='lease_expired'`) | reading.pronunciation |

끝 상태: done·skipped·failed. 끝 상태에서 나가는 전이는 없다. 행은 회차마다 하나이고(`reading_session_id` 유일) 첫 조회만 만든다 —
같은 회차를 다시 조회해도 새로 채점하지 않는다. failed 도 다시 조회해 되살리지 않는다.

## 규칙·제약
- 받는 사람: 스위치 `PRON_REPORT_ENABLED`(기본 false)와 채점 서비스 주소 `PRON_SCORER_URL` 이 모두 있을 때, Pro 회원(결제 판정은
  고품질 목소리와 같다)과 허용 사용자 목록(`PRON_REPORT_ALLOWED_USERS`)의 회원.
- 채점 대상: 그 회차의 녹음 가운데 받아쓴 글이 있고 원래 길이가 1분 이하인 줄. 채점 서비스도 소리 없는 앞뒤를 잘라 낸 길이가
  1분(`PRON_MAX_SECONDS`)을 넘으면 거절한다 — 두 한도가 같아 길이를 아는 줄은 거절당하지 않는다. 줄 하나의 채점이 실패하면 그 줄만
  빼고 이어 간다. 보낸 줄이 모두 실패하면 그 시도가 실패다(채점 서비스가 너무 길다고 거절한 줄은 다시 보내도 같아 실패로 세지 않는다).
- **빠진 줄의 까닭**(SOMA-1171): 보고서에서 빠진 줄은 `skippedLines`(줄 번호)와 같은 순서로 `skippedReasons`(`{lineNo, reason}`)에
  까닭을 남긴다. `NO_TRANSCRIPT`(받아쓴 글이 없음), `TOO_LONG`(원래 길이 1분 넘음, 또는 채점 서비스가 너무 길다고 거절),
  `SCORING_FAILED`(녹음을 받지 못했거나 채점 서비스가 답하지 못함), `OFF_SCRIPT`(받아쓴 글도 들은 소리도 대본과 덜 닮음). 조용히 빠지는
  줄은 없다. 11/26 이전 보고서에는 `skippedReasons` 가 없다.
- 녹음은 배우의 목소리라 임시 파일을 주인만 읽고 쓰게 만들고 끝나면 지운다.
- 줄 수를 줄이지 않는다 — 녹음한 줄을 전부 채점한다. 채점은 한 번에 한 보고서·한 줄씩이라(채점 서비스 하나, 운영 한 줄 약 6초) 긴
  회차는 몇 분 걸린다(11/25 운영, 88줄 넘는 회차 528초).
- **채점 진행**(SOMA-1171): running 이고 일꾼이 진행을 적었으면 `progress` 가 `{done, total}` 이다. `total` 은 채점 서비스에 보낼
  줄 수(받아쓴 글이 있고 1분 이하), `done` 은 그중 끝낸 줄 수(채점했거나 실패해 빠짐)다. 일꾼은 줄마다 적고 다시 집을 때 비운다.
  queued·끝 상태·not_ready 이거나 아직 적지 않았으면 null 이다. 붙잡기 동안에도 1초마다 다시 읽으므로 답에는 그때의 진행이 간다.
  진행을 적지 못해도 채점은 이어 간다.
- **조회 답 붙잡기**(SOMA-1169): 상태가 queued·running 이면 서버가 1초마다 다시 보며 `PRON_REPORT_HOLD_MS`(기본 10000, 0이면
  끔)까지 기다렸다가 답한다. 다 되면 1초 안에 답이 간다. 앱(1.1.x)은 4초 간격으로 45번 묻고 한 번 묻기 시한이 15초라, 이것만으로
  앱이 약 3분 대신 약 10분까지 기다리게 된다.
- **완료 알림**(SOMA-1169): 처음 조회부터 `PRON_REPORT_NOTIFY_AFTER_SECONDS`(기본 60) 넘게 걸려 done 으로 닫은 보고서는 주인에게
  「발음 보고서가 나왔어요」 푸시를 한 번 보낸다(`data.kind=pronunciation_report_ready`, `session_id`). 분석 완료 알림 토글
  (`notify_analysis_done`)을 따르고, 앱 판이 `PRON_PUSH_MIN_APP_VERSION`(기본 1.1.4) 이상인 단말에만 보낸다 — 옛 앱은 알림을
  눌러도 보고서로 가지 못한다. skipped·금방 끝난 것은 알리지 않는다. 알림 실패는 보고서에 영향을 주지 않는다.
- 이관·삭제·탈퇴는 [영역 개요](README.md)의 표를 따른다(회차를 따라 지워진다).

## 예외
- 일꾼이 채점 중에 죽음: 임대가 지나면 다른 일꾼이 다시 집는다. 시도를 다 썼으면 failed 로 닫는다.
- 회차를 지움: 보고서 행도 회차를 따라 지워진다(FK CASCADE).

## 검증 방법
- 끝나지 않은 회차 조회: `not_ready`, 행 없음. 끝난 회차 첫 조회: `queued`, 행 하나. 다시 조회: 행이 늘지 않는다(`ReadingPronunciationIT`, 이 기능의
  테스트 이름은 `reading.pronunciation:` 으로 시작한다).
- 일꾼이 채점: 줄이 있으면 `done` 과 보고서, 쓸 줄이 없으면 `skipped`. 줄 하나의 채점 실패는 그 줄만 빠진다. 빠진 줄마다 까닭이
  남고, 채점 서비스가 너무 길다고 거절한 줄은 `TOO_LONG` 이며 다시 줄 세우지 않는다(`PronunciationWorkerTest`, `PronunciationRulesTest`).
- 세 번 실패: `failed`. 시도를 다 쓴 채 임대가 지남: `failed`, `failure='lease_expired'`.
- 스위치가 꺼졌거나 Pro·허용 사용자가 아님: 404 `pronunciation_not_available`.
- 채점 진행: running 에서 적은 `{done, total}` 이 나가고, 기다리거나 끝났거나 다시 집었으면 null 이다(`ReadingPronunciationIT`,
  `PronunciationWorkerTest`).
- 붙잡기: 만드는 중이면 다 될 때까지(또는 정한 시간까지) 기다려 답한다. 끝 상태·not_ready 는 바로 답한다(`PronunciationReportServiceTest`).
- 완료 알림: 오래 걸린 done 만, 새 앱 판 단말에만 간다(`PronunciationWorkerTest`, `PushServiceTest`, `PushRepositoryIT`).

## 범위 밖
- 보고서를 다시 만들기(같은 회차 재채점), failed 를 되살리기.
- 리딩 중 실시간 발음 표시.

## 열린 질문
- failed 는 끝인데 앱 실패 화면은 「나중에 다시 열어 주세요」와 [다시 시도](다시 조회만 한다)를, 웹은 「나중에 다시 열어 주세요」를
  보인다. 다시 열어도 같은 failed 다. 화면 문구를 바꿀지, 조회 때 failed 를 되살릴지 정한다.
- 앱·웹의 응답 타입에 `not_ready` 가 없어 끝나지 않은 회차에서는 「만드는 중」으로 읽고 다시 묻는다.
