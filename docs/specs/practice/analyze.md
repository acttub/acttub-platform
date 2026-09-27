# practice.analyze 분석

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 1.0.0
- 화면: A10(분석 진행), D6, D7, W6, M6, M6.3, W6.3-R. A10·W6의 "끝날 때까지 이 화면을 켜 두세요"는 화면을 떠나도 분석이 계속된다는 문구로 고친다(디자인에 반영할 것)
- 테이블: analyses, video_transcripts, ai_jobs

## 기능
시작된 회차의 영상을 서버가 분석해 관찰 기록을 만들고 받아쓰기를 남긴다. 화면은 작업 상태를 폴링해 대기·진행·완료·실패를 보여
주고, 완료되면 코치 대화로 넘어간다.

## 의도
현행 분석 워커·상태 전이·실패 분류·재시도(CONTRACT §5-7)는 그대로 두고, 결과 저장을 회차와 1:1인 analyses(기록 전체 jsonb, 완료
뒤 불변)로, 큐를 ai_jobs로 옮긴다. 작업 상태와 결과 상태는 다른 것이다.

## 목적
배우가 분석이 어디까지 됐는지 알고, 끝나면 그 근거로 대화를 시작한다.

## 규칙·제약
- ai_jobs.status는 pending·running·succeeded·failed이고 failed에는 사유(timeout·parse·unsupported·cancelled·account_deactivated 등)가
  붙는다. analyses.status는 ready·partial이다. 부분 실패는 partial로 남기고 못 본 구간을 채우지 않는다.
- analyses는 format으로 갈린다. 신형(video_record_v1)은 acttub.video_record.v1 기록 전체를 jsonb 한 컬럼에 두고 id = record_id다. 기존
  갈래(legacy)는 현행 ObservationPack 원문을 그대로 두고 기존 응답 모양을 유지한다. 둘 다 완료 뒤 덮어쓰지 않고 워커 재시도로 기록
  version을 올리지 않는다. 기존 결과를 신형 형식으로 위장하지 않는다.
- 받아쓰기는 영상 단위로 만들고(원문·단어 시각·간격·처리 구간) 같은 영상의 다음 회차가 재사용한다.
- 폴링은 앱 4초, 웹 10초다. 화면을 떠나면 조회만 멈추고 돌아오면 서버 상태부터 읽는다. 앱은 완료 푸시를 받는다(account.notification).
- 실패 분류는 현행대로다. timeout·parse·unsupported는 즉시 failed, 저장소·ETag 같은 바깥 의존 실패는 다시 큐에 넣고 최대 3회다.
  같은 회차의 완료된 분석을 다시 돌리지 않는다.
- 게스트 하루 3회는 한국 시간 하루의 새 분석 요청 수다(코드 guest_daily_analysis_limit). 같은 요청 id 재전송·워커 재시도·폴링은 세지
  않는다. 회원은 한도가 없다.
- 명시적 취소("그만두기")는 failed/cancelled로 종결하고 lease를 지워 늦은 완료·재큐를 막는다. 화면 이탈은 취소가 아니다. 앱의 옛
  "분석 포기 = 연습 숨김"은 없앤다.
- 분석이 전부 실패하면 코치 대화를 시작할 수 없다(409, practice.coach). 근거 없는 대화를 허용하는 것은 별도 제품 결정이다.
- lease 규칙은 CONTRACT §5-7 그대로다(다른 워커가 선점하기 전에는 만료 뒤 완료도 허용, 토큰이 바뀌면 완료 거절).

## 예외
- 워커의 lease가 다른 워커에게 넘어간 뒤 이전 워커가 완료: 저장이 전부 롤백된다.
- 탈퇴·이관 도중 완료: 탈퇴면 결과를 저장하지 않고 취소, 이관이면 회원에게 결과·알림.
- 3회 모두 바깥 의존 실패: failed, 화면은 다시 시도 버튼(새 작업)을 준다.
- 부분 완료: partial이고 대화는 시작된다. 화면은 "일부 구간은 보지 못했어요"를 보인다.

## 검증 방법
- 시작 뒤 폴링: pending → running → succeeded로 바뀌고 analyses 1행(id = record_id, status ready)이 생긴다.
- 부분 실패 기록: analyses.status partial, 누락 구간이 기록에 있고 채워지지 않았다.
- timeout 실패: 즉시 failed, 재큐 없음. 저장소 실패 1회: 재큐, 2회째 성공 → succeeded, 시도 수 2.
- 게스트 3회 요청 뒤 4번째 시작: 429 guest_daily_analysis_limit. 같은 요청 id 재전송: 세지 않는다. 자정 뒤: 된다.
- parse 실패: 즉시 failed. unsupported: 즉시 failed. 3회 소진: failed, stage closed, "다시 시도"로 새 작업이 생기고 stage analyzing.
- 완료된 analyses의 record를 바꾸는 요청: 없다(불변). 앱은 4초, 웹은 10초 간격으로 status를 읽는다. 완료 시 앱에 푸시가 온다.
- 이관 중 완료: 회원의 회차에 결과, 회원 폰에 푸시. 탈퇴 중 완료: 결과 없음, failed/account_deactivated.
- 기존 갈래(legacy) 회차 완료: analyses.format legacy, 원문 ObservationPack, 기존 응답 모양.
- 취소: failed/cancelled, lease 없음, 늦게 온 완료는 거절.
- 화면을 떠나고 돌아옴: 서버 상태를 다시 읽고 작업은 계속 돌았다.
- 전부 실패한 회차에서 코치 시작: 409.
- lease 만료 뒤 재선점 없이 완료: 저장된다. 재선점 뒤 이전 워커 완료: 롤백.
