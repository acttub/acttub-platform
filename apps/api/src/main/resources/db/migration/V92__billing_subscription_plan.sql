-- 웹(토스) 연 구독(SOMA-1068). 구독과 카드 등록 창에 요금제(plan: monthly·yearly)를 둔다. 값 검사는 BillingRules.Plan 과 저장소 SQL 이
-- 한다(V64 와 같이 CHECK 없음). 웹 연 구독은 BILLING_WEB_YEARLY_ENABLED(기본 false) 뒤에 있어 켜기 전에는 yearly 토스 행이 생기지 않는다.
--
-- billing_subscriptions.plan: 토스 행은 첫 결제 직전에 고른 요금제를 적고 자동결제가 그 금액·기간(월 1개월, 연 1년)으로 청구·연장한다.
--   스토어 행은 store_product_id 에서 정한다(acttub_pro_yearly 면 yearly). 기존 행은 monthly 이고, 이미 들어온 스토어 연 구독만 yearly 로 맞춘다.
-- billing_checkouts.plan: 창을 열 때 고른 요금제. 카드 바꾸기(change_card) 창은 쓰지 않는다.
--
-- 더하기만 하는 변경이다: 기본값이 있는 열 둘이고 옛 서버는 이 열을 읽지 않는다(옛 서버가 쓴 행은 monthly 로 남는다).
ALTER TABLE public.billing_subscriptions ADD COLUMN plan text DEFAULT 'monthly' NOT NULL;
ALTER TABLE public.billing_checkouts ADD COLUMN plan text DEFAULT 'monthly' NOT NULL;

UPDATE public.billing_subscriptions SET plan = 'yearly' WHERE store_product_id = 'acttub_pro_yearly';
