-- 리딩 발음 보고서(SOMA-606) — 리딩 회차 하나 = 보고서 하나. 채점 서비스(apps/pron)를 부르는 작업 큐를 겸한다.
--
-- status: queued → running → done | skipped(쓸 수 있는 줄이 없다) | failed. 값 목록은 앱이 정한다(실험 기능이라
-- CHECK 를 두지 않는다 — 계약이 정해지면 ValueCheckCatalogIT 와 함께 CHECK 로 올린다).
-- user_id 는 기록용이다. 주인 확인은 reading_sessions.user_id 로 한다(이관 때 회차의 주인만 바뀐다).
-- 회차를 지우면 보고서도 지운다. 더하기만 하는 표라 옛 서버는 이 표를 모른다(PracticeRollbackCompatibilityTest).
CREATE TABLE public.reading_pronunciation_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reading_session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    model_version text,
    result jsonb,
    failure text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_pronunciation_reports_pkey PRIMARY KEY (id),
    CONSTRAINT uq_reading_pronunciation_reports_session UNIQUE (reading_session_id),
    CONSTRAINT reading_pronunciation_reports_reading_session_id_fkey
        FOREIGN KEY (reading_session_id) REFERENCES public.reading_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_reading_pronunciation_reports_queue
    ON public.reading_pronunciation_reports (status, lease_until)
    WHERE status = ANY (ARRAY['queued'::text, 'running'::text]);
