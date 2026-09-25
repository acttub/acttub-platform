-- 챌린지 AI 리포트 (challenge.ai-report). ai_jobs 의 종류를 넓히고 참여작당 리포트 한 행을 둔다.

ALTER TABLE public.ai_jobs DROP CONSTRAINT ck_ai_jobs_kind;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ck_ai_jobs_kind
    CHECK ((kind = ANY (ARRAY['analyze'::text, 'memory_update'::text, 'challenge_report'::text])));

-- 참여작과 1:1. "다시 시도"는 같은 행에 새 생성(job_id)을 건다. result 의 문장별 표본 참여작 id 는 내부 전용이다.
-- 참여작 삭제·탈퇴는 본문(result)을 파기하고 purged_at 을 남긴다.
CREATE TABLE public.entry_ai_reports (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.challenge_entries(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    job_id uuid NOT NULL REFERENCES public.ai_jobs(id),
    status text NOT NULL,
    model text,
    format_version integer DEFAULT 1 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    result jsonb,
    requested_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    purged_at timestamp with time zone,
    CONSTRAINT uq_entry_ai_reports_entry UNIQUE (entry_id),
    CONSTRAINT ck_entry_ai_reports_status CHECK (status IN ('pending','ready','failed')),
    CONSTRAINT ck_entry_ai_reports_attempts CHECK (attempt_count BETWEEN 0 AND 3),
    CONSTRAINT ck_entry_ai_reports_ready CHECK (status<>'ready' OR purged_at IS NOT NULL OR result IS NOT NULL),
    CONSTRAINT ck_entry_ai_reports_purged CHECK (purged_at IS NULL OR result IS NULL)
);
CREATE INDEX ix_entry_ai_reports_user ON public.entry_ai_reports(user_id);
