# practice.start 코칭 시작

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: A8(영상 올리기), A8.1(장면 적기), A9.1(막힘 대분류), A9.2(막힘 세부), A9.3(막힘 서술), D4, D5, D6, W4, W5, M5(장면 적는 중), M6.1·M6.1.1·M6.2(막히는 지점), W6.1-R·W6.1.1-R
- 테이블: practices, videos, ai_jobs

## 기능
배우가 영상을 고르고(보관함 또는 새 영상) 상황·인물·목표를 적거나 건너뛰고, 무엇에 막혔는지 고르거나 건너뛰고 시작하면 회차
하나와 분석 작업 하나가 만들어진다. 첫 회차는 새 묶음이다.

## 의도
현행 시작 흐름은 그대로 두고 저장 구조만 회차로 바꾼다. Scene Context는 선택 입력이고 시작 뒤 고치지 않으며(ADR-021 개정),
막힘을 고르지 않으면 "그 외"로 보내 막힘 미특정 세션이 된다(ADR-021 개정). 이론 선택은 코칭에 반영되지 않아 0.1.0에서 뺀다
(common 열린 질문 해소).

## 목적
배우가 영상만 올려도 코칭이 시작되고, 적은 만큼만 코치가 참고한다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/practices` | `X-Request-Id`(본문 request_id와 같아야 한다), `X-Acttub-Contract`, 필수 `request_id`, 선택 `video_id`(영상 없이 말로 하면 뺀다)·`scene`·`blockage`·`title`·`session_purpose` (`PracticeCreateRequest`) | `Practice` 201(`poster_url` 포함, [practice.library](library.md#규칙제약)), 같은 요청 id 재전송도 같은 회차 | `video_not_ready` 422, `request_fingerprint_mismatch` 422, `guest_daily_analysis_limit` 429, `consent_required` 403, 값 모양 오류 422(배열) |
| `POST /v2/practices/{practice_id}/analyze` (닫힌 회차 재시도) | `X-Request-Id`, 필수 `request_id` (`PracticeAnalyzeRequest`) | `Practice` 201, 새 analyze 작업 | `analysis_not_failed` 409, `practice_in_progress` 409, `guest_daily_analysis_limit` 429, `practice_not_found` 404 |

## 상태
practices.stage — 회차 진행 상태의 정본이다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| analyzing | 영상으로 시작·이어하기로 회차 생성, closed 회차의 재시도(묶음에 다른 진행 중 회차가 없을 때) | practice.start, practice.resume |
| conversing | analyzing에서 분석 결과(ready·partial) 저장, 영상 없이 말로 시작(SOMA-745) | practice.analyze, practice.start |
| closed (close_reason analysis_failed) | analyzing에서 분석 즉시 실패 또는 3회 소진 | practice.analyze |
| closed (close_reason cancelled) | 대기·진행 중인 분석 작업을 "그만두기"로 취소 | practice.analyze |
| closed (close_reason conversation_closed) | 코치 대화가 닫힘 | practice.coach |

- 불변 조건: 묶음당 closed가 아닌 회차는 하나다(`uq_practices_open_root`). conversing은 analyzing에서만 들어오고 closed
  회차를 conversing으로 되살리지 않는다. close_reason은 closed일 때만 차고 재시도가 비운다.
- 끝 상태: closed. 재시도만 analyzing으로 되돌린다.
- 회차 진행 상태는 분석 결과의 상태(analyses.status, practice.analyze)와 다르다.

## 규칙·제약
- 게이트: 회원은 [공통 게이트](../common.md#게이트와-보호-기능), 게스트는 연습 동의 셋(account.guest). 게스트의 하루 분석 한도는
  [practice.analyze](analyze.md#규칙제약)가 정한다(429 guest_daily_analysis_limit).
- 회차와 분석 작업은 "시작"을 눌러 영상이 확정돼 있을 때 함께 만든다 — 하나만 생기지 않는다. 요청 id는 (user_id, request_id)
  유일이고 재전송은 [공통 규칙 「요청 재전송」](../common.md#요청-재전송)을 따른다. 설정 화면만 다녀가면 아무것도 남지 않는다.
- 첫 회차는 root_id = 자기 id, ordinal = 1이다. 묶음 속성은 첫 행에 둔다([practice.library](library.md#상태)).
- 시작 때 묶음 제목(`title`, 선택, 200자)을 함께 적을 수 있다(SOMA-671). 앞뒤 공백을 떼어 첫 행의 title에 저장하고, 비었거나
  공백뿐이면 없는 것(null)이다 — 화면이 대체 규칙으로 채운다(practice.library). 시작 뒤에 바꾸는 길은 묶음 속성 수정
  (`PATCH /v2/practices/{root_id}/group`)이다. 이어하기(practice.resume)는 제목을 받지 않고 묶음 제목을 바꾸지 않는다. 제목은
  요청 지문에 든다 — 같은 요청 id에 제목만 다르거나 빠져도 422 request_fingerprint_mismatch다(제목이 없는 요청의 지문은 이 변경
  전과 같다).
- Scene Context(상황·인물·목표)는 셋 모두 선택이고 각 300자까지다. 비우면 빈 문자열로 저장하고 시작 뒤에는 바꾸지 않는다.
  코치가 대화에서 장면을 물어도 그 답은 Scene Context가 되지 않는다.
- 앱 준비 화면(P3.1)은 목적 → 영상 두 단계다(SOMA-748, SOMA-778에서 장면 단계를 뺌). 목적 세 줄(평가 받기·막힌 곳 풀기·인물
  이해하기)은 누르면 바로 영상 단계로 넘어가고(「다음」 버튼 없음) 막힘 큰 갈래(그 외·표현·분석)로 간다. 세부 칩은 없어 세부는 그 외가
  된다. 상황·인물·원하는 것(목표)과 연습 제목 칸은 앱에 없다 — 앱은 장면을 빈 문자열로, 제목은 싣지 않고 시작한다(묶음 제목은 화면이
  대체 규칙으로 채운다, [practice.library](library.md)). 막힘 서술 칸도 없다. 권리 확인 체크는 영상 단계 맨 아래에 있고 체크해야
  시작할 수 있다. 노트의 "다음 테이크 찍기"나 리딩 마무리에서 장면을 넘겨받았으면 그 장면을 화면 없이 그대로 보낸다. 시작하면 코치
  화면으로 가고 분석 대기도 그 안에서 한다([practice.analyze](analyze.md#규칙제약)). API·웹은 그대로다.
- 앱 코칭 탭의 처음 화면(노트가 있는 묶음이 없을 때)은 고정 예시 대화 아래 두 버튼이다. 「지금 찍어서 코칭 받기」는 찍는 법 한 장 →
  카메라로 가고, 찍으면 그 영상을 고른 채 준비 화면(P3.1)을 새로 연다. 「찍어 둔 영상 올리기」는 준비 화면을 바로 연다. 둘 다 첫 코칭이라
  준비 화면의 파란 안내를 켠다.
- 막힘은 큰 갈래(분석·표현·그 외)와 세부(분석의 캐릭터 분석·대사 분석·그 외, 표현의 감정·움직임·화술·표정·그 외), 서술(500자,
  선택)이다. 고르지 않으면 그 외/그 외이고 막힘 미특정으로 부른다. 받아쓰기는 갈래와 무관하게 돈다.
- 이론 선택(스타니슬랍스키 등)은 0.1.0에서 뺀다. 웹 D4의 이론 줄은 없앤다. (디자인에 반영할 것)
- 코칭 갈래는 experience_version(legacy·three_layers_v1)으로 남긴다. 서버의 신형 생성 플래그(`ACTTUB_THREE_LAYERS_ENABLED`, 기본
  false)가 켜져 있고 계약 헤더(`X-Acttub-Contract`)가 three_layers_v1이면 장면·막힘을 적었는지와 무관하게 three_layers_v1(새 코치)이고,
  그 밖은 legacy다(SOMA-508 hotfix). 웹·앱은 이 헤더를 보낸다. 적은 장면·막힘은 새 코치가 받아 쓴다(practice.coach). (v1 당시에는
  상황·인물·목표·막힘 서술이 비어 있고 막힘 큰 갈래가 `그 외`일 때만 신형이었다.)
  본문에 `client_experience` 같은 필드는 없다(헤더가 정본이다). legacy 안의 분석·표현·기본 코치 선택은 막힘 입력으로 정한다(현행).
  플래그를 꺼도 이미 만든 신형 자료는 계속 읽고 다시 분석하지 않는다. 전체를 신형으로 바꾸는 것은 별도 결정이다. 배포 환경의 플래그
  값은 [DEPLOY-HOME §3](../../deploy/DEPLOY-HOME.md#3-actions와-일상-배포)에 있다.
- 판정 순서: 시작은 같은 요청 id 재생 → 영상 확인(422 video_not_ready) → 게스트 하루 한도(429)다. 재시도는 같은 요청 id 재생 →
  없는·남의 회차(404) → 닫히지 않은 회차(409 analysis_not_failed) → 묶음에 진행 중 회차(409 practice_in_progress) → 게스트 하루
  한도(429)다. 재시도에서는 409가 429보다 먼저다.
- 영상 없이 말로 코칭(SOMA-745): `video_id` 를 빼고 `session_purpose` 를 stuck(막힌 곳 풀기)·character(인물 이해하기)·concern(고민
  상담) 중 하나로 보내면 분석 작업 없이 첫 회차가 바로 conversing 으로 생긴다(`video_id` null, `job` null). 코치가 말로 하는 목적별 코칭을
  탄다([practice.coach](coach.md#영상-없이-말로-soma-745)). 새 코치에만 있는 길이라 계약 헤더와 상관없이 experience_version 은
  three_layers_v1 이다. 분석이 없으니 게스트 하루 분석 한도를 쓰지 않는다. 영상 없이 목적을 안 보내거나 evaluate 를 보내면 값 모양 오류
  422(배열)이고 아무것도 남지 않는다(목적 없이 영상을 뺀 요청은 예전과 같은 422 배열이다). 영상과 함께 온 concern 은 목적 없는 회차처럼 지금 코치가 받는다. 같은 요청 id 재전송은 영상
  있는 시작과 같다. 이어하기는 늘 영상으로 한다 — 영상 없는 묶음을 이으려면 새 영상을 보낸다(없으면 422 video_not_ready).
- 리딩 녹음으로 시작(SOMA-791): `video_id`·`session_purpose` 를 빼고 `reading_session_id` 를 보내면 분석 없이 첫 회차가 바로
  conversing 으로 생긴다(목적 reading, 무료 — 무료 코칭 한도를 세지 않는다). 리딩 회차 하나에 하나이고, 이미 있으면 그 회차다.
  자세한 것은 [reading.voice-coaching](../reading/voice-coaching.md). 그 묶음을 영상으로 이은 회차는 평가 받기(evaluate) 목적이다.
- 앱 코칭 탭의 「영상 없이 말로 코칭 받기」는 목적 화면(「말로 어떤 도움을 받을까요?」, 막힌 곳 풀기·인물 이해하기·고민 상담, 단계 표시
  없음)을 연다. 하나를 누르면 바로 영상 없이 시작해 코치 화면으로 간다(「다음」 버튼 없음).
- 얼굴 가리기(`face_mosaic`, 선택, 기본 false): 켠 회차는 분석과 코치가 원본 대신 서버가 얼굴을 가린 사본(챌린지 참여작 모자이크와
  같은 렌더러)을 본다. 사본은 분석 작업과 코치가 그때그때 만들고 저장소에 남기지 않는다. 사본을 만들 수 없으면 원본으로 돌아가지 않는다 —
  얼굴을 못 찾으면 작업 failed(`face_not_found`), 만들 수 없는 기동이면 failed(`face_mosaic_unavailable`)이고 회차는 closed 다.
  코치는 지시문 앞에 「얼굴이 가려져 표정·눈빛·얼굴 근육은 판단하지 말고 말하지 않는다」는 한 줄을 받는다. 원본은 지우지 않는다(바로 지우기는
  앱이 영상 파기로 따로 한다). 영상 없는 회차에서는 무시한다. 이어하기에서 빼면 이어받을 회차의 값이다. 값이 있으면 요청 지문에 든다
  (시작에서 false 는 뺀 것과 같다). 원본이 미리 올리기로도 코치 AI 쪽에 가지 않게, 앱은 그 영상의 올리기 마무리에 `face_mosaic: true` 를
  함께 보낸다([practice.record](record.md)).
- 이미 사용 가능한 영상(보관함)으로 시작하면 업로드를 거치지 않는다. 새 영상이면 practice.record의 올리기를 먼저 마친다.
- 앱에서 올리는 중에 질문 받기를 누르면 「영상을 올리고 있어요」 한 장(P3.2)에서 기다리고, 다 올라가면 바로 시작한다. 이 장에는 버튼과
  진행 막대가 없고 아래에 「화면을 나가도 영상은 계속 올라가요 · 홈에서 올라가는 모습을 이어서 볼 수 있어요」 안내만 있다. 뒤로 가면
  기다리는 업로드로 기억하고 홈으로 간다(10-27, 기다리는 업로드 카드가 홈에 있어서). 올리기는 앱 안 큐가 이어 가고 홈 맨 위 카드가 다 올라간 뒤 코칭을 시작하게
  한다. 올리던 영상을 버리는 길은 없다 — 필요하면 연습 기록에서 지운다. 올리기가 실패하면(P3.24) 「나중에 할게요」는 뒤로 가기와
  같고 「다시 올리기」는 큐를 다시 민다.

## 예외
- 영상이 없거나 남의 것이거나 파일이 파기된 채 시작: 422 video_not_ready.
- 같은 요청 id 재전송: 같은 회차 하나. 이중 탭도 같다.
- 게스트의 하루 4번째 시작: 429 guest_daily_analysis_limit, 회차·작업이 생기지 않는다.
- 만들다 실패: 회차도 작업도 없다.
- 앱은 시작 실패를 질문 받기 버튼 위 빨간 한 줄(InlineError/Line)로 보이고, 서버 오류 코드는 보이지 않는다. 영상을 못 찾음(400
  video_not_found)은 「영상을 찾지 못했어요. 영상을 다시 골라 주세요.」, 모르는 코드는 업로드 실패 문구다.
- 상황·인물·목표 301자, 막힘 서술 501자, 제목 201자: 422(배열). 같은 요청 id·다른 본문: 422 request_fingerprint_mismatch.

## 검증 방법
- 플래그 켬·헤더 three_layers_v1·영상만 고르고 시작: practices 1행(root_id = 자기, ordinal 1, stage analyzing, 막힘 그 외/그 외, 상황·인물·목표
  빈 문자열, experience_version three_layers_v1), ai_jobs 1행(kind analyze, pending).
- 같은 조건에 플래그 끔: experience_version legacy. 헤더 없음: legacy.
- 플래그 켬·헤더 three_layers_v1·상황·막힘(표현 › 감정)을 적고 시작: 저장값이 그대로이고 experience_version three_layers_v1.
- 헤더 없이 상황·막힘(표현 › 감정)을 적고 시작: experience_version legacy, 표현 갈래.
- 같은 요청 id·같은 본문 두 번: 행 하나. 같은 id·다른 본문: 422 request_fingerprint_mismatch. 설정 화면만 다녀감: 행 없음.
- 시작 때 세션 목적(`session_purpose`, 선택, SOMA-719)을 함께 보낼 수 있다: `evaluate`(평가 받기)·`stuck`(막힌 곳 풀기)·
  `character`(인물 이해하기). 첫 행의 session_purpose에 저장하고 회차 응답에 그대로 싣는다. 다른 값·공백은 422(배열)다. 없으면 null이고
  코치는 지금 흐름 그대로다. 이어하기는 목적을 받지 않고 묶음 첫 회차의 목적을 물려받는다. 목적은 요청 지문에 든다(목적이 없는 요청의
  지문은 이 변경 전과 같다). 목적별 대화는 [practice.coach 「목적별 코칭」](coach.md#목적별-코칭-soma-719)이다.
- 확정 안 된 영상: 422 video_not_ready.
- 게스트 4번째: 429 guest_daily_analysis_limit. 자정(한국 시간) 뒤: 된다.
- 트랜잭션을 실패시킴: practices·ai_jobs 둘 다 없다.
- 상황 300자: 200. 301자: 422. 막힘 서술 500자: 200. 501자: 422.
- 제목을 적고 시작: 앞뒤 공백을 뗀 값이 첫 행 title이고 묶음 목록의 title이다. 공백뿐인 제목: null. 200자: 된다. 201자: 422(배열).
  같은 요청 id·다른 제목: 422 request_fingerprint_mismatch. 그 묶음을 이어하기: 묶음 제목 그대로, 이어하기 본문의 title은 422(배열).
- 목적을 고르고 시작: 회차 응답의 session_purpose가 그 값이다. 같은 요청 id·다른 목적·목적을 뺀 본문: 422 request_fingerprint_mismatch.
  모르는 값(worry): 422(배열, loc body.session_purpose), 행이 늘지 않는다. 목적 없이 시작: null. 그 묶음을 이어하기: 첫 회차의 목적.
- 얼굴 가리기를 켜고 시작: practices.face_mosaic true, 분석기와 코치가 받는 파일은 가린 사본이다. 얼굴 없는 영상: 작업 failed
  face_not_found, 분석기·코치 모델은 원본을 받지 않는다. 끄거나 빼고 시작: false, 지금과 같다. 그 묶음을 face_mosaic 없이 이어하기: true.
- 시작 뒤 상황 수정 API: 없다(속성 불변). 대화에서 장면을 답함: practices의 상황은 그대로다.
- 분석 최종 실패: stage closed. 그 회차 재시도: 새 ai_jobs, stage analyzing. 다른 진행 중 회차가 있으면 재시도: 409 practice_in_progress.
- 하루 3회를 쓴 게스트가 아직 분석 중인 회차를 재시도: 429가 아니라 409 analysis_not_failed.
- 웹 D4에 이론 선택이 없다.

## 범위 밖
- 이론 선택(스타니슬랍스키 등). 0.1.0에서 뺀다.
- 시작 뒤 Scene Context 수정, 건너뛴 Scene Context를 나중에 채우는 화면(PRD 「지금 하지 않는 것」, ADR-021).
- 계약 헤더가 없는 구형 클라이언트나 플래그가 꺼진 서버까지 신형(three_layers_v1)으로 바꾸는 것. 별도 결정이다.

## 열린 질문
- 다 올라갔다는 알림이 없다. 올리기는 앱 안 큐(압축 → PUT → 마무리)가 하고, 다 올라가도 로컬 알림을 띄우지 않는다. 그래서 안내는
  알림을 약속하지 않는다. 알림을 더하면 안내 문구도 바꾼다.
- 재시도가 close_reason을 보지 않는다. `PostgresPracticeRepository.retryAnalysis`는 stage가 closed이기만 하면 받아 cancelled·
  conversation_closed 회차도 analyzing으로 돌린다. 규칙은 "실패한 회차"만 다시 시도한다고 하므로 analysis_failed만 받을지 정한다.
