# reading.session 리딩 회차

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: R00.5(상세·회차 목록), R03(시작 위치 선택), R03.0(연습 가이드), R03.1(상대가 읽는 중), R03.2(내 차례·나가기 확인), R05(완료), D17, D18, D19, WR2, WR3, WR4, R00.2(대본 연습 — 0.1.0 미사용, R03.x로 대체)
- 테이블: reading_sessions, script_lines, script_characters

## 기능
내 배역·방식·구간·넘김을 정해 회차를 시작하면 기기가 상대역 대사를 읽고 내 대사에서 멈춰 기다린다. 내
차례는 1.8초 침묵이나 버튼으로 넘어간다. 진행 위치는 서버에 남아 나가도 그 자리에서 이어 하고, 구간의
마지막 대사를 지나면 회차가 끝난다. 끝난 회차와 열린 회차는 대본 상세의 목록에 남는다.

## 의도
웹은 새로 고치면 진행이 사라지고 앱은 기기에만 남는다. 회차가 서버에 있어야 녹음과 다시 볼 대사가 붙고,
게스트가 앱으로 옮겨 이어 갈 수 있다. 연기를 판정하지 않으므로 회차가 남기는 것은 어디까지 읽었고 무엇을
말했는지(녹음·전사)까지다. 회원 자료는 앱에서만 보므로 "어느 기기에서든"은 회원의 앱 기기 사이와 웹
게스트의 앱 이관을 뜻한다. (account.guest)

## 목적
배우가 상대 없이도 장면의 흐름 안에서 자기 대사를 말해 보고, 중단해도 그 자리에서 이어 간다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/reading/scripts/{script_id}/sessions` | `X-Request-Id`(선택, 있으면 본문과 같아야 한다), `ReadingSessionCreateRequest`(request_id·my_character_ids·mode·start_line_id·end_line_id·advance·record) | `ReadingSession` 201, 같은 요청 재전송 200 | `invalid_characters`·`invalid_line`·`empty_range`·`request_fingerprint_mismatch` 422, 형태 오류 422 배열, `script_not_found` 404 |
| `GET /v2/reading/scripts/{script_id}/sessions` | `script_id` | `ReadingSessionList` 200 | `script_not_found` 404 |
| `GET /v2/reading/sessions/{session_id}` | `session_id` | `ReadingSession` 200 | `session_not_found` 404 |
| `PATCH /v2/reading/sessions/{session_id}/progress` | `ReadingSessionProgressRequest`(progress_seq 필수, current_line_id·elapsed_seconds·line_results·complete 선택) | `ReadingSessionProgress` 200(옛 progress_seq도 현재 값) | `session_closed` 409, `invalid_line` 422, `session_not_found` 404 |
| `DELETE /v2/reading/sessions/{session_id}` | `session_id` | 204, 녹음 객체는 삭제 장부로(reading.recording) | `session_not_found` 404 |

## 상태
reading_sessions.status가 이 기능의 정본이다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| in_progress | 회차 시작. 나가기·진행 저장은 이 상태에 머문다 | reading.session |
| completed | 진행 저장의 complete=true(구간의 끝 대사를 지남), ended_at을 찍는다 | reading.session |
| stopped | 같은 대본에 새 회차를 시작함(같은 트랜잭션, `PostgresSessionRepository`) | reading.session |

불변 조건: 대본당 in_progress 회차는 하나다(`uq_reading_sessions_open_script`). 끝 상태는 completed·stopped이고,
행은 회차 삭제·대본 삭제·탈퇴로 지워진다.

- 열린 회차는 대본당 하나다(script_id, status = in_progress 부분 유일 인덱스). 상세(R00.5)의 "새로운
  연습"은 열린 회차를 stopped로 바꾸고 새 회차를 만든다(한 트랜잭션). "이어서 연습 · K / N"은 열린 회차를
  current_line부터 다시 연다.
- 상태는 in_progress에서 completed(구간의 끝 대사를 지남) 또는 stopped(새 회차가 닫음)로 간다. 나가기
  (R03.2)는 위치를 저장하고 in_progress로 남긴다. 나가기 확인 문구는 "지금 나가면 N번 대사까지 진행한
  걸로 저장돼요. 상세에서 이어서 할 수 있어요"로 하고 "끝 위치를 정하지 않았어요"는 뺀다. (디자인에 반영할
  것) completed·stopped는 되돌리지 않고, "다시 리딩"은 같은 설정의 새 회차다. 일시정지는 화면 상태이며
  서버에 없다.

## 규칙·제약
- 회차는 배역·구간을 정하고 "시작"을 누를 때 한 번 만든다. 설정 화면만 다녀가면 아무것도 남지 않는다.
  시작 요청에도 기기 요청 id(UUID)를 싣고 (user_id, request_id)로 유일하게 둬 재전송이 회차를 둘 만들지
  않게 한다.
- 회차 속성은 시작할 때 정하고 뒤에 바꾸지 않는다. 내 배역(reading.cast), 방식 mode(read 읽어주기·quiz
  암기 대조), 구간(start_line_id·end_line_id), 넘김 advance(silence·manual), 녹음 record(켬·끔,
  reading.recording).
  - read: 상대 대사는 기기가 읽고 내 대사는 가리기 설정대로 보인다. STT가 있으면 내 차례에 "방금 말한 것
    (글자로 바꿈)"을 보여 주고 대조 결과를 녹음에 남기지만 흐름에는 끼어들지 않는다.
  - quiz: 내 대사는 가려지고(이 가림은 일반 가리기 설정보다 우선), 말한 것을 기기 STT로 원문과 대조해 통과·미달을
    가른다. 미달이면 "다시"와 "넘어가기"를 주고 같은 줄에 머문다. 같은 줄 2회 미달이면 안내 없이 넘어간다.
    첫 글자 힌트와 원문 보기(현재 줄만 일시 해제)가 있다. STT가 없거나 권한이 없으면 "입력하기"로 글자를 쳐서
    대조한다. 대조 규칙은 reading.memorization.
  - 앱은 지금 read만 있다. quiz를 더한다. (디자인에 반영할 것, R03에 방식 선택)
- 구간은 시작 대사와 끝 대사(둘 다 포함)이고 저장은 줄 id 둘이다. 화면(R03)은 "장면으로 찾기"(장면 줄
  경계, 없으면 지문 경계)와 "대사로 찾기"(대사 번호)로 고르며, 장면을 고르면 그 장면 안 첫·마지막 대사로
  바꾼다. 기본은 처음부터 끝까지다. 구간 안에 내 대사가 없으면 422 empty_range. 웹 D17에는 구간 선택이
  없어 웹은 0.1.0에서 전체 구간으로 시작한다. (디자인에 반영할 것, 후속 가능)
- 가리기(모든 대사 보기·내 대사만 가리기·모든 대사 가리기)는 서버에 저장하지 않는다. R03에서 고른 값으로
  시작하고 실행 중 헤더로 바꾼다. 기기가 대본마다 마지막 값을 기억한다. 가림은 현재·이전·다음 대사와
  옆 대본 보기의 본문에 적용되고 배역 이름·지문·장면은 남긴다. "원문 보기"는 그 줄만 잠깐 푼다. 웹에도
  같은 세 값을 둔다. (디자인에 반영할 것)
- 넘김: silence는 마이크 음량으로 400ms 이상 말한 뒤 1.8초 침묵이 이어지면 신호를 낸다(RMS 임계 0.015, 웹
  현행 상수를 앱에도 그대로). read에서 이 신호는 다음 줄로 가는 것이고, quiz에서는 발화를 확정해 대조하는
  것이다(통과·2회 미달·넘어가기만 다음 줄로 간다). manual은 버튼이다. silence여도 버튼으로 언제나 넘길 수 있고, 자동과 버튼이
  겹쳐도 한 줄만 넘어간다. 아무 말 없이 60초가 지나면 넘기지 않고 "다음을 눌러 넘길 수 있어요"를 보여
  주며 계속 기다린다. 마이크 권한이 없으면 manual로만 시작한다. 임계값은 기기 상수이고 서버는 저장하지
  않는다. 앱은 지금 수동만이라 침묵 감지를 더한다. (확정 결정 7)
- 진행 "K / N · mm:ss": N은 구간 안 대사 줄 수(모든 배역, 지문·장면 제외), K는 지난 대사 수, 시간은 일시정지
  를 뺀 흐른 시간이다. 지문은 화면에만 보이고 진행에서는 건너뛴다. 앱이 지문을 세는 것은 고친다.
- 진행 위치 current_line_id는 다음에 할 대사 줄의 id다(completed에서는 NULL, stopped는 중단 위치 유지). 줄이
  바뀔 때마다(상대 줄 포함), 일시정지·나가기·완료 때 기기가 흐른 시간(elapsed_seconds, 누적)과 순번
  (progress_seq, 기기가 1씩 늘림)을 함께 저장한다. 서버는 progress_seq가 저장된 값보다 큰 요청만 반영하고 작거나
  같으면 무시하고 200으로 현재 값을 돌려준다(늦게 온 옛 요청이 최신을 덮지 못한다). 위치는 구간 안 대사 줄만 받고
  시간은 줄지 않는다. 이어하기는 current_line_id부터 시작하고 그 줄 직전의 상대 대사 하나를 먼저 읽어 흐름을
  잡아 준다.
- 줄별 결과는 회차에 남긴다. reading_sessions.line_results(jsonb, [{line_id, outcome, misses}])는 줄마다 하나이고
  마지막 사건이 이긴다. outcome은 passed(대조 통과)·unmatched(2회 미달 뒤 넘어감, read에서는 1회 미달)·skipped(quiz의
  넘어가기)이고 misses는 미달 횟수다. 녹음을 꺼도, 마이크가 없어 입력하기로 대조해도 여기에 남는다. STT 인식 불가·
  무발화·길이 상한 초과는 넣지 않는다. 다시 볼 대사는 outcome이 unmatched·skipped인 줄이다. 기기가 진행 저장에
  함께 보내고 progress_seq 규칙을 따른다.
- 구간 끝을 지나면 completed, ended_at. 완료 화면(R05·D19·WR4)은 내 배역, 읽은 대사(구간 안 대사 줄 수, 부분 구간을 대본 전체
  완료로 말하지 않음), 걸린 시간, 다시 볼 대사("암기 필요 N", 원문과 대사 번호, 전체보기로 R04), 코치 카드(촬영으로
  잇는 안내, 데이터는 잇지 않음), 다음 행동(다시 리딩·새 대본·홈으로 / 웹은 배역·방식 바꾸기)을 보여 준다. 다시 볼
  대사가 없으면 절을 숨긴다. quiz 완료는 "대사 정확도 %" 대신 "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P"를 보여 준다.
  K는 outcome passed인 줄 수, N은 passed+unmatched(대조를 끝낸 서로 다른 줄, 재시도는 한 번), P는 skipped 줄 수다.
  앱 R05에 코치 카드를 더한다. (디자인에 반영할 것)
- 회차 목록(R00.5)은 최근순이고 항목마다 회차 번호(그 대본에서 시작 순, 집계), 시작 날짜, 상태(진행 중·
  완료·중단), 내 배역, 진행(내 대사 N개 중 K개 녹음, reading.recording), 걸린 시간을 보여 준다. 회차를 지우면
  그 회차의 녹음(파일 포함)이 함께 지워지고 암기 상태는 남는다.
- 리딩 회차는 앱 홈·연습 기록(A1.1)에 섞지 않는다. 연습 기록은 AI 코치와 한 연습만이고, 리딩 기록은
  대본 상세에서 본다(SOMA-494). 서버는 두 목록을 잇지 않는다. (ERD)
- 가이드(R03.0)는 기기당 처음 한 번 보여 준다. 플래그는 기기 저장소에 둔다.
- 앱이 배경으로 가거나 전화가 오면 상대역 읽기·마이크·타이머를 멈추고 위치를 저장한다. 돌아오면 일시정지
  상태에서 배우가 재개를 눌러 그 줄을 처음부터 다시 한다. 마이크는 자동으로 켜지 않는다.
- 게스트도 회차를 쓴다. 이관하면 user_id가 바뀐다. 진행 저장은 게스트의 마지막 활동이다. (account.guest)
- 웹은 회차 저장·이어하기·회차 목록·나가기 확인·다시 볼 대사가 없어 더한다. R00.2(대본 연습, 대사별 메모)는
  R03.x와 겹치는 구안으로 보고 쓰지 않는다. 대사별 메모는 범위 밖이다. 가이드(R03.0)의 문구는 녹음 끔·수동 넘김·
  quiz에 맞게 갈라 "항상 자동 녹음·자동 다음"을 약속하지 않는다. (디자인에 반영할 것)

## 예외
- 마이크 권한 거부: 넘김은 manual, 녹음 없음, quiz는 "입력하기"로만 대조한다. 문구는 "마이크를 허용하면
  말이 끝나면 자동으로 넘어가요".
- 진행 저장 실패(오프라인): 기기는 계속 진행하고 마지막 위치를 들고 있다가 다음 저장 때 보낸다. 앱이 죽으면
  마지막으로 저장에 성공한 위치부터 이어 간다.
- 회차 시작 도중 실패: 열린 회차도 그대로고 새 회차도 없다. 같은 요청 id로 다시 보내면 같은 회차 하나다.
- completed·stopped 회차에 진행 저장: 409 session_closed. 녹음 올리기는 막지 않는다(reading.recording).
- 구간에 내 대사가 없음: 422 empty_range. 시작 줄이 끝 줄 뒤: 422 empty_range.
- 이관·탈퇴·회차 삭제가 먼저 끝난 뒤 도착한 진행 저장: 404이고 옛 계정에 아무것도 남지 않는다.
- 대본이 지워진 뒤 회차 조회: 404.
- 상대역 음성 준비 실패: reading.cast의 예외를 따른다.
- 60초 무발화: 넘기지 않고 안내를 보여 주며 마이크는 열려 있다.

## 검증 방법
- 회차 시작 API(내 배역·방식·구간·넘김·녹음): reading_sessions 1행, status in_progress, current_line_id는 구간의
  첫 대사 줄, started_at이 있다. 같은 요청 id로 다시: 같은 회차 id, 행 하나.
- 열린 회차가 있는 대본에서 "새로운 연습": 이전 회차는 stopped, 새 회차는 in_progress이고 그 대본의
  in_progress는 하나다.
- 설정 화면만 다녀감: reading_sessions 행이 없다. 시작 트랜잭션을 실패시킴: 기존 열린 회차가 그대로다.
- 12번 대사를 지나 13번 저장 응답을 받은 뒤 앱을 강제 종료하고 이어하기: 13번부터, 직전 상대 대사 하나를
  먼저 읽는다. 저장이 실패한 채 종료: 마지막 성공 위치부터.
- progress_seq 7까지 저장된 회차에 seq 5(10번 위치): 200이지만 current_line_id는 그대로다. seq 8에 작은 elapsed:
  시간이 줄지 않는다.
- 구간 마지막 대사를 넘기고 complete: status completed, ended_at 있음, current_line_id NULL, 진행 N / N. 그 회차에
  진행 저장: 409 session_closed. stopped 회차에 진행 저장: 409 session_closed.
- 내 대사 없는 구간으로 시작: 422 empty_range. 시작 줄이 끝 줄 뒤: 422 empty_range.
- 장면 "1막 · 장면 2"를 고름: 그 장면의 첫·마지막 대사가 구간이다. 장면 줄 없는 대본: 지문 경계로 장면이 나뉜다.
- read·silence로 500ms 말하고 1.8초 침묵: 다음 줄로 간다. 300ms 소리 뒤 침묵: 넘어가지 않는다. 버튼: 바로
  다음 줄. 침묵 완료와 버튼이 동시에: 한 줄만 넘어간다. 60초 무발화: 같은 줄에 안내 문구, 마이크는 열려 있다.
- quiz·silence로 말하고 1.8초 침묵: 대조가 실행되고 첫 미달이면 같은 줄에 "다시·넘어가기"가 보인다. 통과: 다음 줄.
- 세 가리기 값: 현재·이전·다음 대사와 옆 대본 본문에 규칙대로 적용되고 배역 이름·지문·장면은 보인다. quiz에서 "모든
  대사 보기": 내 대사는 여전히 가려진다. 원문 보기: 현재 줄만 보이고 다음 줄은 가려진다.
- 마이크를 거부한 상태에서 quiz 시작: "입력하기"로 대조하고 read·manual은 된다.
- 나가기 확인 뒤 나감: status in_progress, current_line_id·elapsed_seconds 저장, 상세에 "이어서 연습 · K / N".
- 30초 일시정지: elapsed_seconds에 들어가지 않는다. 대사 5개·지문 2개 구간 완료: "읽은 대사 5줄".
- quiz에서 한 줄을 2회 미달: 다음 줄로 가고 line_results에 {unmatched, misses 2}. 첫 미달 뒤 통과: {passed, misses 1}.
  넘어가기: skipped. STT 인식 오류 2회: 미달로 세지 않고 line_results에 없다. read에서 대조 미달: 흐름은 그대로고
  line_results에 unmatched.
- 녹음을 끄고 quiz를 하거나 입력하기로 대조: 녹음 행은 없지만 line_results는 남는다.
- 완료 화면: 점수·등급·칭찬 문구가 없다. 다시 볼 대사에는 원문과 대사 번호만 있고 unmatched·skipped가 없으면 절이
  없다. quiz 완료: "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P"이고 K·N·P가 line_results와 맞다.
- 다시 리딩: 같은 설정의 새 회차가 생기고 이전 회차는 그대로다. 코치 카드 선택: 촬영 준비로 가고 리딩 자료는 보내지
  않는다. 첫 진입: 가이드가 보인다.
- 두 번째 회차 시작: 가이드가 나오지 않는다.
- 배경으로 갔다 돌아옴: 일시정지 상태이고 재개를 누르면 같은 줄을 처음부터 한다. 마이크는 재개 뒤 켜진다.
- 회차 삭제: 그 회차의 reading_recordings 행과 객체가 없고 line_memorization 행은 남는다.
- 대본 카드 칩: 열린 회차가 있으면 "연습 중", 마지막 회차가 completed면 "연습 완료".
- 웹 게스트가 회차를 중간까지 하고 앱으로 옮김: 앱 상세에 그 회차가 "이어서 연습"으로 보이고 같은 줄부터
  이어진다.

## 범위 밖
- 대사별 메모(R00.2).
- 가리기·일시정지의 서버 저장.
- completed·stopped 회차 되돌리기.
- 리딩 회차를 앱 홈·연습 기록(A1.1)에 섞기, 코치 카드로 리딩 자료 보내기.
- 점수·등급·칭찬 반응(README).

## 열린 질문
- 코드는 같은 request_id에 속성이 다른 시작 요청을 422 `request_fingerprint_mismatch`로, 구간의 줄이 그 대본의 대사
  줄이 아닌 시작 요청을 422 `invalid_line`으로 거절한다(`SessionService`). 이 문서의 예외에는 둘 다 없다.
- 진행 저장의 위치·줄 결과가 구간 안 대사 줄이 아니면 코드는 422 `invalid_line`이다. 이 문서는 "위치는 구간 안 대사
  줄만 받고"라고만 하고 사유 코드를 적지 않는다.
