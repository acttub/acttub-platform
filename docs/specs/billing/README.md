# 결제

[billing.pg-review PG 심사 전용 테스트 결제](pg-review.md)와 [billing.subscription 앱 ACTTUB Pro 정기결제](subscription.md)가 있다. 앱 정기결제는 플래그(기본 꺼짐) 뒤에 있고 지금은 토스 테스트 키만 받는다. 환불 화면은 아직 없다.

| 기능 | 계정·저장 | 노출 |
|---|---|---|
| billing.pg-review | 심사 전용 계정, 만료되는 메모리 세션·결과 | 웹 `/pg-review`, 홈·사이트맵 제외 |
| billing.subscription | 회원 계정, `billing_subscriptions`·`billing_checkouts`·`billing_payments` | 앱 설정 「ACTTUB Pro」, 무료 한도 시트 |

## 용어

| 이름 | 뜻 | 피할 말 |
|---|---|---|
| 심사 전용 계정 | 테스트 결제 화면만 접근하는 전용 로그인. 실제 앱 회원 계정과 별개 | 실제 구독자 계정 |
| 테스트 승인 | 실제 출금 없이 토스 테스트 환경에서 확인한 승인 | 결제 완료·유료 구독 활성화 |
| 결과 불명 | 승인 요청의 처리 결과를 확정하지 못한 상태 | 결제 실패로 단정 |
