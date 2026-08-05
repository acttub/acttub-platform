# acting-report

3층: acting-agent의 확인된 handoff와 acting-summary의 영상 요약을 받아
분석 카드 또는 표현 카드를 OpenAI로 생성한다.

확인되지 않은 handoff에는 모델을 호출하지 않고 blocked 응답을 반환한다.
표현 카드는 실제로 실행한 experiment와 배우가 확인한 observed_change가 모두 있어야
생성하며, 확인된 분석 handoff가 있으면 참고 전용 문맥으로 함께 전달한다.
새 결과는 `practice_reports`에 저장하고 기존 `reports` 테이블에는 쓰지 않는다.
