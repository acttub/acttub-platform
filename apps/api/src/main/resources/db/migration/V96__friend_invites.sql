-- 친구 초대(SOMA-865). 더하기만 하는 변경이고 옛 서버는 두 표를 모른다(스위치 INVITE_ENABLED 가 꺼져 있으면 아무도 쓰지 않는다).
--
-- invite_codes: 회원 한 명에 초대 코드 하나. 처음 내 코드를 열 때 서버가 만든다. 코드는 헷갈리는 0·O·1·I 를 뺀 6자리
--   (값 모양은 서버가 지킨다). 다른 사람과 겹치지 않게 UNIQUE 로 막는다.
-- invite_redemptions: 초대받은 사람이 코드를 넣은 기록. 사람당 한 줄(PK)이라 코드는 한 번만 넣는다. 가입 출처
--   (user_signup_attributions·user_discovery_answers)와 따로 남는 초대 경로다. rewarded_at 은 첫 연습을 끝내 Pro 1개월이
--   지급된 시각(한 번만 채운다 — 지급의 멱등 키), inviter_rewarded 는 그때 초대한 사람도 받았는지(월 상한에 걸리면 false).
--   초대한 사람의 행이 지워져도 받은 사람의 기록은 남긴다(SET NULL). 그래야 같은 사람이 다른 코드를 다시 넣지 못한다.
--   지급 자체는 billing_pro_grants(reason 'friend_invite')에 기간 줄로 남는다.
CREATE TABLE public.invite_codes (
    user_id uuid NOT NULL PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_invite_codes_code UNIQUE (code)
);

CREATE TABLE public.invite_redemptions (
    invitee_id uuid NOT NULL PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    inviter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rewarded_at timestamp with time zone,
    inviter_rewarded boolean DEFAULT false NOT NULL
);

CREATE INDEX ix_invite_redemptions_inviter ON public.invite_redemptions (inviter_id, rewarded_at);
