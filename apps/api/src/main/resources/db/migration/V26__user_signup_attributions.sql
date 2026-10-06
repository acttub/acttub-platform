-- 가입 계정의 유입 광고 (SOMA-588).
--
-- 앱이 Airbridge SDK 에서 받은 설치 귀속 결과(채널·캠페인·광고 세트·소재 …)를, 그 기기에서 새로 가입한
-- 계정에 한 번 붙인다. 광고 관리자는 가입을 수로만 세고 어느 계정인지 알려주지 않으므로, 광고로 온 배우가
-- 무엇을 쓰고 남는지 보려면 여기서 계정과 잇는다. 읽는 곳은 ops 사용자 화면이다.
--
-- V4 가 지운 users.signup_utm_* 와 다르다 — 그쪽은 웹 UTM 이었고 읽는 곳이 없어 은퇴했다. 이 표는 users 를
-- 넓히지 않고 따로 선다: 계정마다 많아야 한 행이고(처음 온 값만 남는다), 탈퇴 때 행째 지운다
-- (PostgresProfileRepository#withdraw). 계정 행을 지우는 만 14세 미만 종료는 CASCADE 가 따라 지운다.
-- 광고 식별자(IDFA·GAID)는 받지 않는다 — 광고를 가리키는 이름 수준의 값만 둔다.
CREATE TABLE public.user_signup_attributions (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source text NOT NULL,
    platform text NOT NULL,
    channel text NOT NULL,
    campaign text,
    ad_group text,
    ad_creative text,
    content text,
    term text,
    sub_publisher text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT ck_user_signup_attributions_source CHECK (source = 'airbridge'),
    CONSTRAINT ck_user_signup_attributions_platform CHECK (platform IN ('ios', 'android'))
);
