-- 앱 ACTTUB Pro 정기결제(SOMA-818). 토스페이먼츠 자동결제(카드 등록 → 빌링키 → 첫 결제 → 매월 자동결제)의 장부 셋이다.
-- 결제 기능은 BILLING_APP_ENABLED(기본 false)로 꺼져 있으며, 꺼져 있으면 아무도 이 표를 쓰지 않는다.
--
-- billing_subscriptions: 사람마다 한 줄. status 는 active·canceled(자동결제만 해지, 이번 기간 끝까지 Pro)·past_due(자동결제 실패,
--   retry_count 번 실패했고 next_retry_at 에 다시 시도)·expired(Pro 아님 — 아직 첫 결제 전인 카드 등록도 여기다). 값 검사는
--   BillingRules.Status 와 저장소 SQL 이 한다(CHECK 없음 — 발음 보고서와 같은 방식).
--   current_period_end 가 다음 결제일이다. billing_key 는 평문이 아니라 AccountSecrets(AES-256-GCM, 키 버전 접두사)의 암호문이고,
--   해지 기간이 끝나 expired 가 되면 지운다. card_number 는 토스가 준 가린 번호(예: 4330****1234***)다.
--   lease_until 은 자동결제 스케줄러가 한 줄을 집어 처리하는 동안의 점유다(FOR UPDATE SKIP LOCKED 로 집는다).
-- billing_checkouts: 카드 등록 창 하나. 앱에 준 일회용 state 의 SHA-256 만 둔다. open → processing(콜백이 한 번만 집는다)
--   → done·failed·unknown. purpose 는 subscribe(첫 결제까지)·change_card(카드만 바꿈).
-- billing_payments: 결제 시도 하나가 한 줄이고 order_id 가 토스 주문 ID 이자 멱등 키다(UNIQUE). 같은 order_id 는 두 번 승인을
--   요청해도 토스가 같은 결제로 본다. status 는 pending·done·failed·unknown(결과 모름 — 같은 키로만 다시 묻는다).
--
-- 사람이 지워지면 함께 지워진다(ON DELETE CASCADE). 탈퇴는 구독을 expired 로 바꾸고 빌링키를 지운다(결제 기록은 남긴다).
-- 더하기만 하는 변경이다: 새 표 셋이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.billing_subscriptions (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status text NOT NULL,
    customer_key text NOT NULL,
    billing_key text,
    card_company text,
    card_number text,
    amount integer NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    canceled_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    lease_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_billing_subscriptions_user UNIQUE (user_id),
    CONSTRAINT uq_billing_subscriptions_customer_key UNIQUE (customer_key)
);

CREATE INDEX ix_billing_subscriptions_due ON public.billing_subscriptions (status, current_period_end);

CREATE TABLE public.billing_checkouts (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    state_hash text NOT NULL,
    purpose text NOT NULL,
    customer_key text NOT NULL,
    order_id text NOT NULL,
    status text NOT NULL,
    result_code text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_billing_checkouts_state UNIQUE (state_hash)
);

CREATE INDEX ix_billing_checkouts_user ON public.billing_checkouts (user_id, created_at DESC);

CREATE TABLE public.billing_payments (
    id uuid NOT NULL PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES public.billing_subscriptions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    order_id text NOT NULL,
    kind text NOT NULL,
    amount integer NOT NULL,
    status text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    approved_at text,
    failure_code text,
    check_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_billing_payments_order UNIQUE (order_id)
);

CREATE INDEX ix_billing_payments_subscription ON public.billing_payments (subscription_id, period_start, attempt);
CREATE INDEX ix_billing_payments_unknown ON public.billing_payments (status, updated_at) WHERE (status = 'unknown');
