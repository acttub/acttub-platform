-- 웹 블로그(app.blog, SOMA-834 2차). 운영자가 쓰고 acttub.com/blog 가 읽는 글 한 편이 한 행이다.
--
-- 더하기만 하는 변경이다: 새 테이블 하나. 직전 운영 서버는 이 테이블을 모르고 되돌려도 그대로 뜬다.
-- 값 목록은 text + CHECK 다(ADR-023, CONTRACT.md §5-3-1). 값 이름은 DB 값이자 API 값이다.
-- 읽는 시간은 저장하지 않는다 — 본문 길이에서 계산한다(BlogRules.readingMinutes).
CREATE TABLE public.blog_posts (
    id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    category text NOT NULL,
    body_markdown text NOT NULL,
    cover_image_url text,
    app_cta text DEFAULT 'none' NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    author_name text DEFAULT '액터브 팀' NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_posts_pkey PRIMARY KEY (id),
    CONSTRAINT uq_blog_posts_slug UNIQUE (slug),
    CONSTRAINT ck_blog_posts_category CHECK ((category = ANY (ARRAY['practice'::text, 'admissions'::text, 'audition'::text, 'news'::text]))),
    CONSTRAINT ck_blog_posts_app_cta CHECK ((app_cta = ANY (ARRAY['coaching'::text, 'reading'::text, 'challenge'::text, 'none'::text]))),
    CONSTRAINT ck_blog_posts_status CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);

CREATE INDEX idx_blog_posts_status_published ON public.blog_posts USING btree (status, published_at DESC);
