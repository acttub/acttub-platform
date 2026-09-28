# reading.recording 녹음

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: R03.2(내 차례, 녹음 표시), R00.4(삭제 확인의 녹음 수), R00.5(회차별 녹음·재생), R05(다시 볼 대사), D18, D19, WR3
- 테이블: reading_recordings, reading_sessions, script_lines, account_cleanup_operations(ERD에 추가)

## 기능
회차에서 내 차례마다 기기가 마이크로 내 대사를 녹음해 줄 단위 파일로 서버에 올린다. STT가 있으면 전사와
원문 대조 결과를 함께 저장한다. 회차 상세에서 줄마다 다시 듣거나 내 대사를 이어 듣고, 회차나 대본을 지우면
함께 지워진다.

## 의도
자기 대사를 다시 듣는 것이 리딩 연습의 핵심 피드백이다. 지금 앱은 회차 전체를 한 파일로 기기에만 남겨 어느
대사가 어디인지 찾기 어렵고 웹은 녹음이 없다. 줄 단위여야 대본의 줄과 맞물려 "이 대사 다시 듣기"와 "다시 볼
대사"가 가능하다. 내 차례에만 녹음하므로 상대역 음성이 섞이지 않는다. 서버가 음성을 분석하지 않으므로 AI
분석 동의는 필요 없다. (확정 결정 4)

## 목적
배우가 회차가 끝난 뒤 자기 대사를 줄마다 다시 듣고, 웹에서 남긴 녹음을 앱으로 옮긴 뒤에도 듣는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/reading/sessions/{session_id}/recordings` | multipart `ReadingRecordingUploadForm`(request_id·line_id·attempt_no·audio·duration_ms·transcript_source, transcript·matched 선택), `X-Request-Id`(선택, 있으면 본문과 같아야 한다). 서버가 받아 m4a가 아니면 변환하고 객체 저장소에 올린 뒤 행을 만든다. 올릴 자리를 따로 받지 않는다 | `ReadingSessionRecording` 201(생성·대체), 200(같은 요청 재전송·더 작은 attempt_no, 현재 값) | `recording_too_long`·`invalid_line`·`recording_quota` 422, 칸 형태 422 배열, `session_not_found` 404, `audio_conversion_failed`·`storage_not_configured` 503, 25MB 초과 `upload_too_large` 413 |
| `GET /v2/reading/sessions/{session_id}`(재생) | `session_id` | `ReadingSession`의 `recordings`(줄 순서, 10분 서명 `playback_url`) 200 | `session_not_found` 404 |
| `DELETE /v2/reading/recordings/{recording_id}` | `recording_id` | 204, 객체는 삭제 장부로 | `recording_not_found` 404 |
| `ReadingRecordingCleanup.attempt`(삭제·대체 커밋 직후), `AccountCleanupScheduler.run`(`ACCOUNT_CLEANUP_INTERVAL_MS`, 기본 5분) | 삭제 장부의 `reading_recording_delete` | 녹음 객체 삭제 | 실패하면 장부에 남아 재시도, 7일마다 운영자 알림 |
| 탈퇴·미이관 게스트 30일 파기(`PostgresProfileRepository#eraseReading`, account.withdraw) | 그 사람의 녹음 행 | 보관 동의자만 행을 남기고 회차·줄 연결을 비움, 나머지는 행·전사 삭제와 객체 장부 | — |
| `AccountHousekeepingScheduler.run`(`ACCOUNT_HOUSEKEEPING_CRON`, 매일 04:30 KST)의 3년 파기(`purgeRetained`) | 최초 탈퇴 뒤 3년 지난 보관 녹음 | 행 삭제와 객체 장부 | — |

## 상태
없음 — reading_recordings에 상태 컬럼이 없다. attempt_no(1 이상)는 대체 순서를, transcript_source(stt·none)는 전사 출처를 가를 뿐이다.

## 규칙·제약
- 녹음은 회차 속성 record(켬·끔)로 시작할 때 정한다. 시작 화면이 "내 차례 녹음은 내 계정에 저장돼요"를
  보여 준다. 마이크 권한이 있으면 기본은 켬이다. quiz 방식도 켤 수 있고 끌 수 있다. 내 차례에만 녹음하고
  상대역 재생·일시정지 중에는 녹음하지 않는다. 웹 D17의 "소리는 어디에도 안 나가요"는 없앤다. (디자인에
  반영할 것, 처리방침)
- 단위는 내 대사 줄 하나 = 파일 하나다. (reading_session_id, line_id)가 유일하다. 같은 줄을 다시 말하면
  (quiz의 "다시") 새 녹음이 이전 것을 대체한다. 기기는 줄마다 시도 번호(attempt_no, 1부터 1씩)를 붙여 보내고,
  서버는 저장된 번호보다 큰 시도만 받아 대체하며(행 id는 그대로) 같은 번호·같은 요청 id는 같은 결과(멱등), 작은 번호는 무시하고
  200으로 현재 값을 돌려준다. 대체된 객체는 삭제 장부로 지운다. 시도마다 남기는 안은 저장량과 화면 복잡도 때문에
  0.1.0에서 택하지 않았다.
- 올리기: 내 차례가 끝나면 기기가 multipart 한 요청으로 request_id, line_id, attempt_no, 음성 파일, duration_ms,
  전사와 대조(있으면)를 보낸다. 서버가 검사·변환한 뒤 객체 저장소에 넣고 행을 만든다. 파일이 작아(수 초~수 분)
  서버 경유를 받아들이고 영상처럼 올릴 자리를 따로 받지 않는다. 올리기는 회차의 진행 상태와 분리된다. 다음 줄을
  막지 않고, completed·stopped 회차에도 소유권·줄·한도 검사를 통과하면 받는다(session_closed는 진행 저장에만).
  회차·대본이 지워졌으면 404이고 녹음이 되살아나지 않는다. 저장 직전에 소유자·계정 상태·회차 존재를 다시 확인한다.
  칸의 모양(필수·UUID·정수·값 목록, transcript_source가 none인데 전사·대조가 실림) 오류는 422 배열이다. `X-Request-Id`
  헤더는 reading.script와 같은 규칙이다. 요청 전체가 25MB를 넘으면 칸을 읽기 전에 413 upload_too_large다.
- 검사 순서: 크기·길이(422 recording_too_long) → 회차(404 session_not_found)·줄(422 invalid_line)·같은 요청 id(200
  현재 값)·같은 줄에 같거나 큰 attempt_no(200 현재 값) → 변환 → 객체 저장(스토리지 설정이 없으면 503
  storage_not_configured) → 최종 저장(같은 확인을 다시 하고 총량을 본다).
- 형식: 앱은 되도록 m4a(AAC)로 올리되 온디바이스 STT가 켜진 동안은 인식기가 저장한 파일을 그대로 올릴 수 있다. 웹은 브라우저가 내는
  형식(webm/opus 또는 mp4/aac)으로 올린다. 서버는 content_type을 보고 m4a(AAC)가 아니면(`audio/mp4`·`audio/m4a`·`audio/x-m4a`·
  `audio/aac`는 그대로 둔다) 올리는 자리에서 m4a로 바꿔 저장한다(영상에 쓰는
  ffmpeg, 내용은 읽지 않음). 저장 형식이 하나여야 이관 뒤 앱에서 웹
  녹음을 들을 수 있다. 변환에 성공한 m4a만 저장 완료다. 변환이 실패하면 503 audio_conversion_failed로 답하고
  행을 만들지 않으며 임시 객체를 정리한다. 기기는 같은 요청 id로 다시 시도한다. content_type·바이트 수(변환 뒤)·
  길이를 행에 둔다.
- 객체 키는 사용자·회차·줄·요청 id로 만들어 재사용하지 않는다(`reading/{user_id}/{session_id}/{line_id}/{request_id}.m4a`).
  변환 결과는 그 행의 객체 키가 아직 같을 때만 반영하고, 반영하지 못한 원본·변환본은 삭제 장부에 넣는다.
- 한도: 파일 10,000,000바이트(올린 원본 기준), 길이 180초를 넘으면 422 recording_too_long. line_id가 그 회차의 구간
  안 내 대사 줄이 아니면 422 invalid_line. 계정당 총량은 저장된 바이트 합으로 회원 1,000,000,000바이트, 게스트
  100,000,000바이트이며 넘으면 기존은 보존하고 새 저장만 422 recording_quota다. 대체는 앞 녹음의 바이트를 빼고 센다. 이관으로 넘어도 보존한다. 숫자는
  성능·사용량 근거 없는 초기 한도다.
- 행에는 현재 소유자 user_id를 둔다(이관 때 회차와 함께 바뀜, 탈퇴 보관 때 유지).
- 전사 transcript와 대조 matched는 기기 결과만 저장한다. transcript_source는 stt(기기 STT)·none이고 none이면
  transcript·matched가 NULL이다. 입력하기(타이핑)로 한 대조는 녹음 행을 만들지 않고 회차의 line_results에만 남는다.
  matched는 정상 인식 뒤 대조 미달만 false이고 인식 불가·무발화는 NULL이다. 점수·거리는 저장하지 않는다. 통과선
  (자모 편집거리 0.72)과 규칙은 기기 상수다. (reading.memorization)
- 재생은 짧은 서명 URL(10분)로 한다. `playback_expires_at`이 만료 시각이고 조회할 때마다 새로 만든다. 스토리지
  설정이 없으면 둘 다 null이다. 회차 상세(R00.5)는 회차마다 "내 대사 N개 중 K개 녹음 · mm:ss · P%"
  (N = 구간 안 내 대사 수, K = 녹음된 줄 수)를 보여 주고, 펼치면 줄 순서로 줄 원문·길이·재생·전사(있으면)가
  나오며 "이어 듣기"가 내 대사 녹음을 순서대로 튼다. 개별 녹음 삭제가 있다. 없는 녹음과 남의 녹음은 같은 404
  recording_not_found다.
- 객체 삭제는 이관·삭제·탈퇴 표를 따른다.
- 탈퇴: 기본은 파기다. "탈퇴 후 영상·녹음 보관·활용" 동의자의 녹음(음성과 전사)은 회차·줄 연결(reading_session_id,
  line_id)을 비우고 user_id(deactivated)를 유지해 최초 탈퇴 시각부터 한국 시간 달력 3년 남기며, 영상과 같은 3년
  파기가 지운다. 동의를 철회하면 함께 파기한다. 대본 원문·배역 이름은 보관 행에 복제하지 않는다. 동의하지 않은
  사람의 전사는 녹음과 함께 지운다(영상 연습의 받아쓰기 보존 규칙과 다르다). 보관 행은 일반 API에서 보이지
  않는다. (account.withdraw, ERD 변경)
- 웹에 녹음과 다시 듣기를 더한다. 앱은 회차 전체 한 파일에서 줄 단위로 바꾼다. (디자인에 반영할 것)

## 예외
- 올리기 실패(오프라인, 503): 기기가 파일과 요청 id를 들고 있다가 다시 시도한다. 회차가 끝난 뒤에도 남은 파일을
  이어서 시도하고, 앱을 다시 열어도 큐가 남는다. 7일 지난 파일은 버린다. 웹은 서버 저장이 끝나기 전에 탭을
  닫으면 "저장 중인 녹음이 있어요"를 알린다.
- 마이크 권한 거부: record는 끔이고 화면에 녹음 표시가 없다.
- 같은 (회차, 줄)에 더 큰 시도 번호: 뒤 것이 남고 앞 객체는 삭제 장부에 들어간다. 같은 요청 id: 행 하나. 더 작은 시도
  번호가 늦게 옴: 무시되고 200 현재 값.
- 완료·중단된 회차에 올리기: 검사를 통과하면 저장된다. 대본·회차가 지워진 뒤 늦게 온 올리기: 404이고 녹음이
  되살아나지 않는다. 이관 처리 중에 옛 게스트로 올리기: 옛 계정에 남지 않는다.
- 180초에 이르면 녹음을 멈추고 현재 줄은 그대로다. 파일이 10,000,000바이트를 넘으면 기기가 보내지 않고 "이 줄
  녹음은 너무 길어 저장하지 않았어요"를 보여 준다.
- 재생 URL 만료 뒤 재생: 기기가 목록을 다시 조회해 새 URL을 받는다.
- 변환 실패: 503 audio_conversion_failed, 행·객체 없음, 기기가 같은 요청 id로 재시도.
- 스토리지 설정이 없음: 올리기는 503 storage_not_configured, 회차 조회는 열리고 재생 주소만 null이다.
- 요청 전체가 25MB를 넘음: 413 upload_too_large, 행·객체 없음.
- 일시정지·상대역 재생 중: 마이크가 꺼져 있어 그 소리는 녹음에 없다.

## 검증 방법
- record 켬으로 회차를 시작해 내 대사 둘을 말함: reading_recordings 2행, 각 행의 line_id가 그 줄이고 user_id가 나이며
  객체가 있고 상대역 줄에는 행이 없다.
- 같은 줄을 "다시"로 다시 말함(attempt_no 2): 행은 하나, 객체 키가 바뀌고 이전 키가 삭제 장부에 있다.
- 같은 요청 id 재전송: 행 하나, 객체 하나. attempt_no 1이 attempt_no 2 뒤에 늦게 도착: 200이고 행은 2번 그대로다.
- 웹에서 webm/opus로 올림: 저장된 객체는 m4a이고 content_type이 audio/mp4다. 이관 뒤 앱에서 재생된다.
- 변환을 실패시킴: 503 audio_conversion_failed, 행·객체 없음. 같은 요청 id로 다시: 200.
- 10,000,001바이트 파일: 422 recording_too_long, 행 없음. 181초: 422 recording_too_long. 정확히 180초: 저장되고 녹음이 멈춘다.
- 총량 1,000,000,000바이트를 넘긴 회원의 새 녹음: 422 recording_quota, 기존 행 그대로. 게스트 100,000,000바이트 초과도 같다.
  이관으로 총량을 넘긴 회원: 기존은 모두 보이고 새 저장만 422.
- 구간 밖 줄 id 또는 상대역 줄 id: 422 invalid_line. completed 회차에 검사를 통과한 올리기: 201. 지워진 회차: 404.
- STT 없이 올리기: transcript_source none, transcript·matched NULL, 201. STT 인식 불가: matched NULL. 정상 인식 뒤 미달:
  matched false. 정상 인식 뒤 통과: matched true.
- 녹음을 끈 회차: 행이 없다. 상대역이 읽는 동안의 소리: 내 녹음에 들어가지 않는다.
- 회차 상세 조회: "내 대사 5개 중 2개 녹음 · 0:41 · 40%"처럼 수가 맞고 줄 순서 목록에 재생 URL이 있다. 11분 뒤
  그 URL: 실패. 목록 재조회: 새 URL. 이어 듣기: 두 녹음이 순서대로 재생된다.
- 개별 녹음 삭제: 그 행·객체가 없고 회차 진행·암기 상태는 그대로다.
- 회차 삭제 / 대본 삭제 / 보관 동의 없는 탈퇴 / 미이관 게스트 31일: 행·객체·전사가 없다.
- 보관 동의자 탈퇴: 행이 남고 user_id는 그대로, reading_session_id·line_id가 NULL, 객체·전사가 있다. 3년 뒤: 없다. 철회:
  없다. 보관 행은 일반 조회 API에 나오지 않는다.
- 객체 삭제가 계속 실패: 7일 뒤에도 장부에 키가 남고 운영자 알림이 있다.
- 웹 게스트가 녹음 둘을 남기고 앱으로 옮김: 앱의 회차 상세에 녹음 둘이 보이고 재생되며 user_id가 회원이다.
- 마이크 거부 상태로 시작: 화면에 녹음 표시가 없고 행이 생기지 않는다.
- 일시정지 중에 말함: 녹음에 들어가지 않는다.
- 응답만 유실된 올리기를 재시도: 같은 녹음 하나. 이관 처리 중 옛 게스트로 올리기: 옛 계정에 행이 없다.

## 범위 밖
- 시도마다 녹음 남기기. 같은 줄은 마지막 시도 하나만 남는다.
- 서버의 음성 분석·전사. 서버는 형식 변환만 하고 내용을 읽지 않는다(README).
- 점수·거리 저장.
- 영상처럼 올릴 자리를 따로 받는 업로드.
- 옛 앱의 회차 전체 녹음 옮기기(reading.script).
