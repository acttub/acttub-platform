-- 웹 게스트의 자기 보고 UTM을 가입 유입 원장에 함께 둔다 (SOMA-591 후속).
--
-- source/platform은 서버가 고정한다. airbridge는 기존 앱 값(ios·android), web_utm은 web만 허용한다.
-- 웹 값은 store-links와 같은 짧은 ASCII 토큰만 받아 URL·이메일·자유 입력이 들어갈 자리를 만들지 않는다.
-- 한 계정 한 행과 최초값 보존, 탈퇴 시 행 삭제는 V26의 계약을 그대로 유지한다.
ALTER TABLE public.user_signup_attributions
    ADD COLUMN medium text;

ALTER TABLE public.user_signup_attributions
    DROP CONSTRAINT ck_user_signup_attributions_source,
    DROP CONSTRAINT ck_user_signup_attributions_platform,
    ADD CONSTRAINT ck_user_signup_attributions_source
        CHECK (source IN ('airbridge', 'web_utm')),
    ADD CONSTRAINT ck_user_signup_attributions_platform
        CHECK (platform IN ('ios', 'android', 'web')),
    ADD CONSTRAINT ck_user_signup_attributions_source_platform
        CHECK ((source = 'airbridge' AND (platform = 'ios' OR platform = 'android'))
            OR (source = 'web_utm' AND platform = 'web')),
    ADD CONSTRAINT ck_user_signup_attributions_web_values
        CHECK (source <> 'web_utm' OR (
            channel ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            AND (medium IS NULL OR medium ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
            AND (campaign IS NULL OR campaign ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
            AND (content IS NULL OR content ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
            AND (term IS NULL OR term ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
            AND ad_group IS NULL
            AND ad_creative IS NULL
            AND sub_publisher IS NULL
        ));
