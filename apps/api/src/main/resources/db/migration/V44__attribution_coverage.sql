-- 가입 유입 기록의 출처 구분과 가입한 앱 판 (SOMA-643).
--
-- ops 가 "기록 없음" 한 덩어리로 보던 앱 가입을 원인별로 가르려고 두 칸을 더한다. 둘 다 사용자 식별 값이 아니다.
--  - user_signup_attributions.recorded_via: 누가 이 행을 적었나. app(앱이 SDK 콜백으로) · server(서버가 Airbridge 를
--    조회해서, AirbridgeAttributionSync) · web(웹 UTM). 기존 행은 web_utm 만 web 이고 나머지는 앱이 적은 것이다.
--  - user_profiles.signup_client: 프로필을 처음 완성한 클라이언트(X-Acttub-Client 헤더 값, 예: app/0.1.4).
--    처음 한 번만 적고 바꾸지 않는다. NULL 허용이라 이 칸을 모르는 옛 서버의 INSERT 도 통한다.
ALTER TABLE public.user_signup_attributions
    ADD COLUMN recorded_via text NOT NULL DEFAULT 'app';

UPDATE public.user_signup_attributions SET recorded_via = 'web' WHERE source = 'web_utm';

ALTER TABLE public.user_signup_attributions
    ADD CONSTRAINT ck_user_signup_attributions_recorded_via CHECK (recorded_via IN ('app', 'server', 'web'));

ALTER TABLE public.user_profiles
    ADD COLUMN signup_client text;
