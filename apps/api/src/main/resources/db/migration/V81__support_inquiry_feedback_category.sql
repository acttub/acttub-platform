-- 앱 안 의견 보내기(SOMA-953). 문의 분류에 'feedback'(의견)을 더한다.
--
-- 기존 값은 그대로 두고 허용 값만 하나 늘린다. 직전 운영 서버는 feedback 을 보내지 않으므로 되돌려도 그대로 뜬다.
ALTER TABLE public.support_inquiries DROP CONSTRAINT ck_support_inquiries_category;
ALTER TABLE public.support_inquiries
    ADD CONSTRAINT ck_support_inquiries_category
    CHECK ((category = ANY (ARRAY['account'::text, 'billing'::text, 'refund'::text, 'usage'::text, 'bug'::text, 'report'::text, 'other'::text, 'feedback'::text])));
