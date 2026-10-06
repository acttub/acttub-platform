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
| `POST /v2/practices` | `X-Request-Id`(본문 request_id와 같아야 한다), `X-Acttub-Contract`, 필수 `request_id`·`video_id`, 선택 `scene`·`blockage` (`PracticeCreateRequest`) | `Practice` 201, 같은 요청 id 재전송도 같은 회차 | `video_not_ready` 422, `request_fingerprint_mismatch` 422, `guest_daily_analysis_limit` 429, `consent_required` 403, 값 모양 오류 422(배열) |
| `POST /v2/practices/{practice_id}/analyze` (닫힌 회차 재시도) | `X-Request-Id`, 필수 `request_id` (`PracticeAnalyzeRequest`) | `Practice` 201, 새 analyze 작업 | `analysis_not_failed` 409, `practice_in_progress` 409, `guest_daily_analysis_limit` 429, `practice_not_found` 404 |

## 상태
practices.stage — 회차 진행 상태의 정본이다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| analyzing | 시작·이어하기로 회차 생성, closed 회차의 재시도(묶음에 다른 진행 중 회차가 없을 때) | practice.start, practice.resume |
| conversing | analyzing에서 분석 결과(ready·partial) 저장 | practice.analyze |
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
- Scene Context(상황·인물·목표)는 셋 모두 선택이고 각 300자까지다. 비우면 빈 문자열로 저장하고 시작 뒤에는 바꾸지 않는다.
  코치가 대화에서 장면을 물어도 그 답은 Scene Context가 되지 않는다.
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
- 이미 사용 가능한 영상(보관함)으로 시작하면 업로드를 거치지 않는다. 새 영상이면 practice.record의 올리기를 먼저 마친다.

## 예외
- 영상이 없거나 남의 것이거나 파일이 파기된 채 시작: 422 video_not_ready.
- 같은 요청 id 재전송: 같은 회차 하나. 이중 탭도 같다.
- 게스트의 하루 4번째 시작: 429 guest_daily_analysis_limit, 회차·작업이 생기지 않는다.
- 만들다 실패: 회차도 작업도 없다.
- 상황·인물·목표 301자, 막힘 서술 501자: 422. 같은 요청 id·다른 본문: 422 request_fingerprint_mismatch.

## 검증 방법
- 플래그 켬·헤더 three_layers_v1·영상만 고르고 시작: practices 1행(root_id = 자기, ordinal 1, stage analyzing, 막힘 그 외/그 외, 상황·인물·목표
  빈 문자열, experience_version three_layers_v1), ai_jobs 1행(kind analyze, pending).
- 같은 조건에 플래그 끔: experience_version legacy. 헤더 없음: legacy.
- 플래그 켬·헤더 three_layers_v1·상황·막힘(표현 › 감정)을 적고 시작: 저장값이 그대로이고 experience_version three_layers_v1.
- 헤더 없이 상황·막힘(표현 › 감정)을 적고 시작: experience_version legacy, 표현 갈래.
- 같은 요청 id·같은 본문 두 번: 행 하나. 같은 id·다른 본문: 422 request_fingerprint_mismatch. 설정 화면만 다녀감: 행 없음.
- 확정 안 된 영상: 422 video_not_ready.
- 게스트 4번째: 429 guest_daily_analysis_limit. 자정(한국 시간) 뒤: 된다.
- 트랜잭션을 실패시킴: practices·ai_jobs 둘 다 없다.
- 상황 300자: 200. 301자: 422. 막힘 서술 500자: 200. 501자: 422.
- 시작 뒤 상황 수정 API: 없다(속성 불변). 대화에서 장면을 답함: practices의 상황은 그대로다.
- 분석 최종 실패: stage closed. 그 회차 재시도: 새 ai_jobs, stage analyzing. 다른 진행 중 회차가 있으면 재시도: 409 practice_in_progress.
- 하루 3회를 쓴 게스트가 아직 분석 중인 회차를 재시도: 429가 아니라 409 analysis_not_failed.
- 웹 D4에 이론 선택이 없다.

## 범위 밖
- 이론 선택(스타니슬랍스키 등). 0.1.0에서 뺀다.
- 시작 뒤 Scene Context 수정, 건너뛴 Scene Context를 나중에 채우는 화면(PRD 「지금 하지 않는 것」, ADR-021).
- 계약 헤더가 없는 구형 클라이언트나 플래그가 꺼진 서버까지 신형(three_layers_v1)으로 바꾸는 것. 별도 결정이다.

## 열린 질문
- 재시도가 close_reason을 보지 않는다. `PostgresPracticeRepository.retryAnalysis`는 stage가 closed이기만 하면 받아 cancelled·
  conversation_closed 회차도 analyzing으로 돌린다. 규칙은 "실패한 회차"만 다시 시도한다고 하므로 analysis_failed만 받을지 정한다.
