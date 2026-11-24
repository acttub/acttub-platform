# reading.pronunciation 발음 보고서

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-606 (Pro 혜택은 SOMA-818)
- 화면: 리딩 끝 화면의 발음 보고서(앱 `app/reading/pronunciation.tsx`, 웹 `features/reading/screens/PronunciationReportScreen.tsx`)
- 테이블: reading_pronunciation_reports

## 기능
끝낸 리딩 회차의 녹음을 발음 채점 서비스(`apps/pron`)로 보내 줄마다 잘못 들린 말과 자주 나온 발음 버릇을 모은 보고서를 만든다.
Pro 혜택이다. 서버 스위치를 켠 서버에서만 돈다(실험, OpenAPI 에 싣지 않는다).

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/reading/sessions/{session_id}/pronunciation` | 헤더 `Authorization`(게이트 통과) | `{status, report}` 200. `status` 는 아래 「상태」의 값이고, `report` 는 done·skipped 일 때만 `{summary, misheard, habit, skipped_lines}`, 그 밖은 null | 스위치가 꺼졌거나 Pro·허용 사용자가 아님 404 `pronunciation_not_available`, 남의 회차·없는 회차 404 `session_not_found` |
| `PronunciationWorkerScheduler`(`PRON_REPORT_POLL_MS`, 기본 5초) | queued 보고서, 임대가 지난 running 보고서 | 채점 뒤 done·skipped 저장, 실패면 다시 queued 또는 failed | 시도 3번 소진이면 failed |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| not_ready(응답에만, 행 없음) | 회차가 completed 가 아님 | reading.pronunciation |
| queued | 끝난 회차를 처음 조회함(행을 만든다). 시도가 남은 실패 | reading.pronunciation |
| running | 일꾼이 집음(시도 수 +1, 임대 `PRON_REPORT_LEASE_SECONDS` 기본 600초). 임대가 지난 running 을 다시 집음 | reading.pronunciation |
| done | 채점한 줄이 하나 이상이라 보고서가 비지 않음 | reading.pronunciation |
| skipped | 쓸 줄이 없음(받아쓴 글이 없거나 1분 넘는 녹음뿐이라 채점한 줄이 0) | reading.pronunciation |
| failed | 시도 3번(`PRON_REPORT_MAX_ATTEMPTS`)을 다 쓴 실패, 또는 시도를 다 쓴 채 임대가 지남(`failure='lease_expired'`) | reading.pronunciation |

끝 상태: done·skipped·failed. 끝 상태에서 나가는 전이는 없다. 행은 회차마다 하나이고(`reading_session_id` 유일) 첫 조회만 만든다 —
같은 회차를 다시 조회해도 새로 채점하지 않는다. failed 도 다시 조회해 되살리지 않는다.

## 규칙·제약
- 받는 사람: 스위치 `PRON_REPORT_ENABLED`(기본 false)와 채점 서비스 주소 `PRON_SCORER_URL` 이 모두 있을 때, Pro 회원(결제 판정은
  고품질 목소리와 같다)과 허용 사용자 목록(`PRON_REPORT_ALLOWED_USERS`)의 회원.
- 채점 대상: 그 회차의 녹음 가운데 받아쓴 글이 있고 1분 이하인 줄. 줄 하나의 채점이 실패하면 그 줄만 빼고 이어 간다. 모든 줄이
  실패하면 그 시도가 실패다.
- 녹음은 배우의 목소리라 임시 파일을 주인만 읽고 쓰게 만들고 끝나면 지운다.
- 이관·삭제·탈퇴는 [영역 개요](README.md)의 표를 따른다(회차를 따라 지워진다).

## 예외
- 일꾼이 채점 중에 죽음: 임대가 지나면 다른 일꾼이 다시 집는다. 시도를 다 썼으면 failed 로 닫는다.
- 회차를 지움: 보고서 행도 회차를 따라 지워진다(FK CASCADE).

## 검증 방법
- 끝나지 않은 회차 조회: `not_ready`, 행 없음. 끝난 회차 첫 조회: `queued`, 행 하나. 다시 조회: 행이 늘지 않는다(`ReadingPronunciationIT`, 이 기능의
  테스트 이름은 `reading.pronunciation:` 으로 시작한다).
- 일꾼이 채점: 줄이 있으면 `done` 과 보고서, 쓸 줄이 없으면 `skipped`. 줄 하나의 채점 실패는 그 줄만 빠진다(`PronunciationWorkerTest`).
- 세 번 실패: `failed`. 시도를 다 쓴 채 임대가 지남: `failed`, `failure='lease_expired'`.
- 스위치가 꺼졌거나 Pro·허용 사용자가 아님: 404 `pronunciation_not_available`.

## 범위 밖
- 보고서를 다시 만들기(같은 회차 재채점), failed 를 되살리기.
- 리딩 중 실시간 발음 표시.

## 열린 질문
- failed 는 끝인데 앱 실패 화면은 「나중에 다시 열어 주세요」와 [다시 시도](다시 조회만 한다)를, 웹은 「나중에 다시 열어 주세요」를
  보인다. 다시 열어도 같은 failed 다. 화면 문구를 바꿀지, 조회 때 failed 를 되살릴지 정한다.
- 앱·웹의 응답 타입에 `not_ready` 가 없어 끝나지 않은 회차에서는 「만드는 중」으로 읽고 다시 묻는다.
