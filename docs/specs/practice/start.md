# practice.start 코칭 시작

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 1.0.0
- 화면: A8(영상 올리기), A8.1(장면 적기), A9.1(막힘 대분류), A9.2(막힘 세부), A9.3(막힘 서술), D4, D5, D6, W4, W5, M5(장면 적는 중), M6.1·M6.1.1·M6.2(막히는 지점), W6.1-R·W6.1.1-R
- 테이블: practices, videos, ai_jobs

## 기능
배우가 영상을 고르고(보관함 또는 새 영상) 상황·인물·목표를 적거나 건너뛰고, 무엇에 막혔는지 고르거나 건너뛰고 시작하면 회차
하나와 분석 작업 하나가 만들어진다. 첫 회차는 새 묶음이다.

## 의도
현행 시작 흐름은 그대로 두고 저장 구조만 회차로 바꾼다. Scene Context는 선택 입력이고 시작 뒤 고치지 않으며(ADR-021 개정),
막힘을 고르지 않으면 "그 외"로 보내 막힘 미특정 세션이 된다(CONTEXT). 이론 선택은 코칭에 반영되지 않아 1.0.0에서 뺀다
(common 열린 질문 해소).

## 목적
배우가 영상만 올려도 코칭이 시작되고, 적은 만큼만 코치가 참고한다.

## 규칙·제약
- 게이트: 회원은 공통 게이트, 게스트는 연습 동의 셋(account.guest). 게스트 분석은 하루 3회다(429 guest_daily_analysis_limit, 현행 코드
  유지, practice.analyze).
- 회차와 분석 작업은 "시작"을 눌러 영상이 확정돼 있을 때 한 트랜잭션으로 만든다. 요청에 기기 request_id를 싣고 (user_id,
  request_id) 유일로 두 번 만들지 않으며, 생성 본문의 지문(request_fingerprint)을 저장해 같은 id·다른 지문은 422
  request_fingerprint_mismatch다(현행 계약). 이관으로 게스트·회원의 request_id가 겹치면 게스트 쪽을 비우고 회차·작업·자료는 보존한다.
  설정 화면만 다녀가면 아무것도 남지 않는다.
- 첫 회차는 root_id = 자기 id, ordinal = 1이다. 묶음 속성(제목·태그·즐겨찾기·숨김)은 첫 행에 둔다.
- Scene Context(상황·인물·목표)는 셋 모두 선택이고 각 300자까지다. 비우면 빈 문자열로 저장하고 시작 뒤에는 바꾸지 않는다.
  코치가 대화에서 장면을 물어도 그 답은 Scene Context가 되지 않는다.
- 막힘은 큰 갈래(분석·표현·그 외)와 세부(표현의 감정·움직임·화술·표정·그 외), 서술(500자, 선택)이다. 고르지 않으면 그 외/그 외이고
  막힘 미특정으로 부른다. 받아쓰기는 갈래와 무관하게 돈다.
- 이론 선택(스타니슬랍스키 등)은 1.0.0에서 뺀다. 웹 D4의 이론 줄은 없앤다. (디자인에 반영할 것)
- 코칭 갈래는 experience_version(legacy·three_layers_v1)으로 남긴다. 서버의 신형 생성 플래그가 켜져 있고 계약 헤더가 three_layers_v1이며
  영상만 올리고 장면·막힘을 적지 않은 현행 무입력 조건일 때만 three_layers_v1(영상부터 시작하는 기본 코치)이고, 그 밖은 legacy다.
  legacy 안의 분석·표현·기본 코치 선택은 막힘 입력으로 정한다(현행). 플래그를 꺼도 이미 만든 신형 자료의 읽기는 유지한다. 전체를
  신형으로 바꾸는 것은 별도 결정이다.
- 회차 진행 상태(practices.stage)는 analyzing·conversing·closed 셋이고 분석 결과의 상태(analyses.status)와 다르다. 시작은 analyzing,
  분석 결과가 ready·partial로 저장되면 conversing, 분석 최종 실패(3회 소진)·명시적 취소·대화 종료면 closed다. 실패한 회차를 명시적으로
  다시 시도하면 새 작업과 함께 analyzing으로 돌아간다(다른 진행 중 회차가 없을 때만). 묶음당 closed가 아닌 회차는 하나다(부분 유일).
  코치 시작은 그 경험 판의 사용 가능한 분석 결과가 있는지 본다.
- 이미 사용 가능한 영상(보관함)으로 시작하면 업로드 단계가 없다. 새 영상이면 practice.record의 올리기를 먼저 마친다.

## 예외
- 영상이 확정되지 않은 채 시작: 422 video_not_ready.
- 같은 요청 id 재전송: 같은 회차 하나. 이중 탭도 같다.
- 게스트의 하루 4번째 시작: 429 guest_daily_analysis_limit, 회차·작업이 생기지 않는다.
- 트랜잭션 실패: 회차도 작업도 없다.
- 상황·인물·목표 301자, 막힘 서술 501자: 422. 같은 요청 id·다른 본문: 422 request_fingerprint_mismatch.

## 검증 방법
- 플래그 켬·헤더 three_layers_v1·영상만 고르고 시작: practices 1행(root_id = 자기, ordinal 1, stage analyzing, 막힘 그 외/그 외, 상황·인물·목표
  빈 문자열, experience_version three_layers_v1), ai_jobs 1행(kind analyze, pending).
- 같은 조건에 플래그 끔: experience_version legacy. 헤더 없음: legacy.
- 상황·막힘(표현 › 감정)을 적고 시작: 저장값이 그대로이고 experience_version legacy, 표현 갈래.
- 같은 요청 id·같은 본문 두 번: 행 하나. 같은 id·다른 본문: 422 request_fingerprint_mismatch. 설정 화면만 다녀감: 행 없음.
- 확정 안 된 영상: 422 video_not_ready.
- 게스트 4번째: 429 guest_daily_analysis_limit. 자정(한국 시간) 뒤: 된다.
- 트랜잭션을 실패시킴: practices·ai_jobs 둘 다 없다.
- 상황 300자: 200. 301자: 422. 막힘 서술 500자: 200. 501자: 422.
- 시작 뒤 상황 수정 API: 없다(속성 불변). 대화에서 장면을 답함: practices의 상황은 그대로다.
- 분석 최종 실패: stage closed. 그 회차 재시도: 새 ai_jobs, stage analyzing. 다른 진행 중 회차가 있으면 재시도: 409 practice_in_progress.
- 웹 D4에 이론 선택이 없다.
