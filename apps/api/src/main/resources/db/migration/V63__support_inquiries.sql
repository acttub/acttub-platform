-- 웹 문의하기(app.support-inquiry, SOMA-834). 로그인 없이 받는 문의를 서버에 쌓는다.
--
-- 더하기만 하는 변경이다: 새 테이블 하나. 직전 운영 서버는 이 테이블을 모르고 되돌려도 그대로 뜬다.
--
-- user_id 는 문의를 보낼 때 유효한 액세스 토큰이 붙어 있었을 때만 채운다(NULL 이면 비로그인 문의). FK 를 두지 않는다 —
-- 탈퇴가 users 행을 지우는 순서에 문의가 끼어들어 막지 않게 하고, 문의 기록은 계정과 따로 보관한다.
-- email·body 는 개인정보라 로그에 남기지 않는다(애플리케이션 규칙).
-- 값 목록은 text + CHECK 다(ADR-023, CONTRACT.md §5-3-1). 값 이름은 DB 값이자 API 값이다.
CREATE TABLE public.support_inquiries (
    id uuid NOT NULL,
    category text NOT NULL,
    email text NOT NULL,
    body text NOT NULL,
    user_id uuid,
    client text,
    status text DEFAULT 'open' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_inquiries_pkey PRIMARY KEY (id),
    CONSTRAINT ck_support_inquiries_category CHECK ((category = ANY (ARRAY['account'::text, 'billing'::text, 'refund'::text, 'usage'::text, 'bug'::text, 'report'::text, 'other'::text]))),
    CONSTRAINT ck_support_inquiries_status CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);

CREATE INDEX idx_support_inquiries_status_created ON public.support_inquiries USING btree (status, created_at DESC);
