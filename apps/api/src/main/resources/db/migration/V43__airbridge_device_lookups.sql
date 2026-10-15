-- 앱이 넘긴 Airbridge 기기 ID(GAID·IDFA/IDFV)를 서버가 설치 귀속 조회에 쓰려고 잠깐 두는 표. 한 계정에 한 줄.
--
-- 임시 보관이다: 귀속을 user_signup_attributions 에 적었거나, 이미 귀속이 있거나, 24시간이 지나면 이 줄(과 기기 ID)을
-- 바로 지운다. 탈퇴·게스트 이관 파기에서도 지운다. 다른 곳에 복사하지 않고 로그에도 싣지 않는다.
-- 쓰는 곳: PUT /v2/me/airbridge-device(넣기), AirbridgeAttributionSync(조회·재시도·지우기).
CREATE TABLE public.user_airbridge_device_lookups (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    platform text NOT NULL,
    device_uuid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT ck_user_airbridge_device_lookups_platform CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);

CREATE INDEX idx_user_airbridge_device_lookups_due ON public.user_airbridge_device_lookups (next_attempt_at);
