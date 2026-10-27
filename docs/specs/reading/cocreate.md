# reading.cocreate 찍을 대사 같이 만들기
- 도입: 1.0 개편 (SOMA-721)
- 화면: pen 「v4 C 코칭 입구 · 첫」의 「찍을 대사부터 같이 만들기」, 「대본 같이 만들기 · 감정·상황」·「· 결과」
- 테이블: script_cocreations (확정하면 scripts·script_characters·script_lines)

## 기능
찍을 대본이 없는 배우가 감정 → 상황 → 원하는 방향(선택)을 고르면 AI 가 짧은 생성 대본(1인 독백 또는 2~4인 장면)을 만든다.
배우는 고치고(성공한 수정만 무료 3회) 확정한다. 확정한 대본은 기존 「내 대본」에 저장돼 리딩에서도 읽고, 「지금 찍을래요」로
영상 코칭의 새 연습에 장면 정보를 채워 넘긴다.

## 의도
대본이 없어 코칭을 시작하지 못하는 배우에게 바로 찍을 수 있는 대사를 준다. 대본은 생성한 글만 쓴다 — 사용자 대본이나 기존
작품을 프롬프트에 넣지 않는다.

## 목적
코칭 탭 입구에서 대본 없이 들어온 배우가 1분 안팎의 대본을 받아 찍기까지 이어지게 한다.

## 입력·출력
- `POST /v2/sample-scripts` — request_id, 경력(beginner·exam·experienced, 앱은 프로필 경력에서 고른다), 나이·성별·목표(프로필),
  감정·상황·방향(자유 글), 배역 수 1~4(1 = 독백, 기본 1), 분량 1·3·10분(기본 1). 새로 만들면 201, 같은 request_id 는 200.
- `GET /v2/sample-scripts/{id}` — 지금 버전.
- `POST /v2/sample-scripts/{id}/revisions` — base_version + 자유 요청·배역 수·분량을 한 번에. 성공하면 새 버전.
- `POST /v2/sample-scripts/{id}/restore` — 지난 버전을 지금 버전으로.
- `POST /v2/sample-scripts/{id}/save` — 확정. 「내 대본」의 script_id 를 준다(처음 201, 다시 200).
- 응답: 제목·장소·배역(이름·성별·나이대·내 배역)·줄(scene·direction·dialogue)·설계도 일부(관계·직전 사건·소품·목표)·추정 낭독 초·
  남은 무료 수정·수정 설명·script_id.

## 상태
만드는 중(versions 없음) → 만듦(버전 1) → 고침(버전 n, 수정 횟수 +1) ⇄ 되돌림(지금 버전만 바뀜) → 확정(script_id). 확정 뒤에는
고치거나 되돌리지 않는다. 확정한 대본을 지우면 script_id 만 비고 생성 기록은 남는다.

## 규칙·제약
- 모델: 코칭 키 Gemini 클라이언트, `ACTTUB_SAMPLE_SCRIPT_MODEL`(기본 gemini-4-argon). 프롬프트는 2026-10-19 인계본의 생성·수정·걸린
  줄 고치기 셋이고 독백판만 더했다(`apps/api/src/main/resources/reading/sample-script/`).
- 검사: 구조(배역 수·내 배역 하나·모르는 배역·대사 없는 배역·분량·대화의 내 비중 25~60%), 줄(길이·괄호·감정 이름·글 같은
  어미·안전 금지어·지문 25자·표정 지문). 줄 문제는 고치기 프롬프트로 한 번 고친다. 구조·안전·연속 발화가 남으면 다른 결말·소품으로
  한 번 더 만들고, 그래도 안 되면 실패다. 줄 길이 같은 가벼운 경고는 보인다.
- 분량은 대사 5자 = 1초로 어림한 추정이다. ±25% 허용도 시험 가정이며 실제 낭독으로 보정하지 않았다. 화면은 「약 1분」으로만 보인다.
- 수정: 성공한 수정만 센다. 생성 대본 한 건에 무료 3회이고 되돌려도 돌려주지 않는다. 다 쓰면 안내만 한다(결제·Pro 화면 없음).
- 같은 request_id 는 모델을 한 번만 부른다. 24시간에 20개까지 만든다. 결말·소품은 그 사람의 최근 셋과 겹치지 않게 고르고,
  20세 미만에게는 10대용 결말·소품만 쓴다.
- 회원 전용이다(경로가 /v2/reading/** 밖). 게이트가 필수 동의(ai_analysis 포함)를 확인한다.
- 확정은 기존 대본 저장을 그대로 쓴다(출처 typed, 생성 기록 id 가 요청 id, 대본 수 한도 동일). 배역 성별·나이대는 모델 값이다.
- 탈퇴의 리딩 파기가 생성 기록을 함께 지운다.
- 앱 「대본을 만들고 있어요」 아래에는 「화면을 나가도 대본은 계속 만들어져요 · 다 되면 알림으로 알려 드릴게요.」를 둔다. 만드는 중에
  뒤로 가면 연 탭의 첫 화면으로 간다 — 대본 올리기(리딩)에서 열었으면 리딩 탭, 코칭 탭 입구에서 열었으면 코칭 탭(10-27).

## 예외
| 상황 | 응답 |
|---|---|
| 배역 수·분량이 범위 밖 | 422 sample_script_invalid_options |
| 같은 request_id 가 아직 만드는 중 | 409 sample_script_in_progress |
| 24시간 20개 초과 | 429 sample_script_daily_limit |
| 모델 실패·검사 불통과 | 502 sample_script_failed (기록 없음, 같은 request_id 로 다시 가능) |
| 없는 것·남의 것 | 404 sample_script_not_found |
| 무료 수정 소진 | 429 sample_script_revision_limit |
| 지금 버전이 아님 | 409 sample_script_version_conflict |
| 다른 수정 중 | 409 sample_script_busy |
| 확정한 대본을 고치거나 되돌림 | 409 sample_script_saved |
| 바꿀 것이 없음 | 422 sample_script_no_change |
| 수정 실패 | 502 sample_script_revision_failed (원본·횟수 그대로) |
| 없는 버전으로 되돌림 | 422 sample_script_version_not_found |

## 검증 방법
`CocreateRulesTest`·`ScriptCocreateServiceTest`(인계본 회귀 테스트의 검사·과금·실패 유지), `ScriptCocreateIT`(HTTP·Postgres, 확정 뒤
리딩 대본 조회), 모바일 `tests/screens/script-cocreate.test.tsx`·`tests/script-cocreate.test.mjs`. 실제 모델은
`ScriptCocreateLiveTest`(ACTTUB_SAMPLE_SCRIPT_LIVE_TEST=1, GEMINI_API_KEY)로 세 편을 만든다.

## 범위 밖
리딩 탭의 「대본 같이 만들기」 입구, 액터브 추천 대본 고르기, 스트리밍 미리보기, Pro 과금, 실제 낭독 시간 보정, 영상 코칭에 대본
전문을 넘기는 것(지금은 장면 칸 셋만 채운다).

## 열린 질문
- 나간 뒤에 다 만든 대본을 다시 찾을 길과 알림이 없다. 서버는 같은 요청을 끝까지 만들지만 확정 전 생성 대본은 목록 API가 없고 완료
  푸시도 없다. 「다 되면 알림으로 알려 드릴게요」를 지키려면 둘 다 필요하다.
- 무료 3회의 단위(생성 대본 한 건)와 Pro 정책은 과금이 열릴 때 다시 정한다.
- 안전 키워드 검사는 오탐·누락이 있을 수 있다. 10대 입력 조합의 안전 필터 막힘 원인은 확인하지 못했다.
