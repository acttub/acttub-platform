ALTER TABLE public.consent_documents DROP CONSTRAINT ck_consent_documents_type;
ALTER TABLE public.consent_documents
    ADD CONSTRAINT ck_consent_documents_type
    CHECK (type = ANY (ARRAY['terms','privacy','ai_analysis','retention','cloud_voice']));

CREATE TABLE public.reading_voice_cache (
    hash text PRIMARY KEY,
    model text NOT NULL,
    voice text NOT NULL,
    byte_size integer NOT NULL CHECK (byte_size > 0),
    created_at timestamptz NOT NULL
);

CREATE TABLE public.reading_voice_usage (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    day date NOT NULL,
    lines integer NOT NULL CHECK (lines >= 0),
    PRIMARY KEY (user_id, day)
);

CREATE INDEX idx_reading_voice_usage_day ON public.reading_voice_usage(day);
