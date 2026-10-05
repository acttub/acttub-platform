-- 앱 첫 화면 공지 포스터 (SOMA-599, app.poster).
--
-- 홈 진입 때 뜨던 고품질 목소리 홍보 팝업은 문구·이미지·버튼이 앱에 박혀 있었다. 그것을 서버가 내려주는 범용 포스터로
-- 바꾼다 — 이 표의 행만 바꾸면 앱 업데이트 없이 내용이 바뀐다. 운영자는 /v2/admin/posters 로 고친다.
--
-- slug 는 기기에 남는 "봤음·다시 보지 않기" 의 열쇠이고, revision 을 올리면 그 기록이 무효가 되어 다시 보인다.
-- (slug, 언어) 는 언어 없음(NULL)까지 포함해 유일하다. 지우지 않고 active=false 로 끈다.
-- image·audio 는 'asset:<이름>'(앱 번들 자산) 또는 운영자가 올린 객체 키 'posters/<uuid>.<ext>' 다.
CREATE TABLE public.app_posters (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    slug text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT false NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    platforms text[] DEFAULT '{ios,android}'::text[] NOT NULL,
    locale text,
    min_app_version text,
    frequency text DEFAULT 'daily' NOT NULL,
    audience text DEFAULT 'all' NOT NULL,
    dismissible boolean DEFAULT true NOT NULL,
    badge text,
    title text NOT NULL,
    body text,
    image text,
    audio text,
    cta_label text,
    cta_action text DEFAULT 'none' NOT NULL,
    cta_target text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_app_posters_revision CHECK (revision >= 1),
    CONSTRAINT ck_app_posters_platforms
        CHECK (cardinality(platforms) > 0 AND platforms <@ ARRAY['ios', 'android']::text[]),
    CONSTRAINT ck_app_posters_locale CHECK (locale IS NULL OR locale ~ '^[a-z]{2}$'),
    CONSTRAINT ck_app_posters_min_app_version
        CHECK (min_app_version IS NULL OR min_app_version ~ '^[0-9]+(\.[0-9]+)*$'),
    CONSTRAINT ck_app_posters_frequency CHECK (frequency IN ('daily', 'once')),
    CONSTRAINT ck_app_posters_audience CHECK (audience IN ('all', 'cloud_voice_off')),
    CONSTRAINT ck_app_posters_cta_action CHECK (cta_action IN ('none', 'cloud_voice_enable', 'route', 'url')),
    CONSTRAINT ck_app_posters_cta_target
        CHECK ((cta_action <> 'route' OR (cta_target IS NOT NULL AND cta_target LIKE '/%'))
           AND (cta_action <> 'url' OR (cta_target IS NOT NULL AND cta_target LIKE 'https://%'))),
    CONSTRAINT ck_app_posters_image
        CHECK (image IS NULL OR image ~ '^asset:[a-z0-9-]+$'
            OR image ~ '^posters/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'),
    CONSTRAINT ck_app_posters_audio
        CHECK (audio IS NULL OR audio ~ '^asset:[a-z0-9-]+$'
            OR audio ~ '^posters/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'),
    CONSTRAINT ck_app_posters_period CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE UNIQUE INDEX uq_app_posters_slug_locale ON public.app_posters (slug, COALESCE(locale, ''));

-- 첫 포스터: 지금 앱에 박혀 있는 고품질 목소리 출시 홍보를 그대로 옮긴다(문구는 앱 번역의 cloudVoice.promo* 값).
-- 끝은 무료 기간이 끝나는 KST 12/1 00:00 이다. 고품질 목소리를 아직 켜지 않은 사람에게만 보인다(판정은 앱).
INSERT INTO public.app_posters
    (slug, locale, active, priority, ends_at, frequency, audience, dismissible,
     badge, title, body, image, audio, cta_label, cta_action)
VALUES
    ('cloud-voice-launch', 'ko', true, 10, '2026-11-30T15:00:00Z', 'daily', 'cloud_voice_off', true,
     '출시 기념 · 11월 30일까지 무료', E'상대역이\n진짜 배우처럼 읽어 줘요',
     '대본 리딩 상대 대사를 더 자연스러운 AI 목소리로. 두 달 동안 무료예요.',
     'asset:mascot-reading', 'asset:cloud-voice-sample', '무료로 켜기', 'cloud_voice_enable'),
    ('cloud-voice-launch', 'en', true, 10, '2026-11-30T15:00:00Z', 'daily', 'cloud_voice_off', true,
     'Launch offer · Free until Nov 30', E'Your scene partner\nreads like a real actor',
     'Hear scene-partner lines in a more natural AI voice during script reading. Free for two months.',
     'asset:mascot-reading', 'asset:cloud-voice-sample', 'Turn on for free', 'cloud_voice_enable');
