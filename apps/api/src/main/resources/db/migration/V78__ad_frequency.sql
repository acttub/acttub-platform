-- 한 사람에게 광고가 너무 자주 뜨지 않게 하는 빈도 상한(SOMA-876). "window_minutes 분 동안 window_cap 개까지"만 내보내고,
-- 가입 24시간 이내(첫날) 사용자는 window_cap 대신 first_day_cap 을 쓴다. 숫자는 광고 관리 웹이 /v2/admin/ad-settings 로 바꾼다(앱 빌드 없음).
--
-- ad_settings: 한 줄짜리 설정(id=1). 값 검사(창 1~1440분, 상한 0~100)는 관리자 API 가 한다(CHECK 없음 — 다른 광고 표와 같은 방식).
-- ad_serves: 사람에게 실제로 내보낸 광고(HOUSE·NETWORK·DIRECT)의 기록. NONE 은 남기지 않는다. 오래된 기록은 하루 한 번 지운다.
--
-- 더하기만 하는 변경이다: 새 표 둘이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.ad_settings (
    id integer DEFAULT 1 NOT NULL PRIMARY KEY,
    window_minutes integer DEFAULT 10 NOT NULL,
    window_cap integer DEFAULT 5 NOT NULL,
    first_day_cap integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO public.ad_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.ad_serves (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    served_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX ix_ad_serves_user_served ON public.ad_serves (user_id, served_at);
