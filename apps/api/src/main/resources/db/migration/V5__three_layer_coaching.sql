-- Expand: 구형 연습/관찰/노트와 계속 공존한다. 새 연습의 생성 정책은 애플리케이션이 정한다.
ALTER TABLE public.practice_sessions
    ADD COLUMN experience_version text NOT NULL DEFAULT 'legacy',
    ADD CONSTRAINT ck_practice_sessions_experience_version
        CHECK (experience_version IN ('legacy', 'three_layers_v1'));

ALTER TABLE public.coach_sessions
    ADD COLUMN coaching_state_json jsonb,
    ADD COLUMN state_revision bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_coach_sessions_state_revision CHECK (state_revision >= 0),
    ADD CONSTRAINT ck_coach_sessions_coaching_state_object
        CHECK (coaching_state_json IS NULL OR jsonb_typeof(coaching_state_json) = 'object');

ALTER TABLE public.coach_sessions DROP CONSTRAINT ck_coach_sessions_close_reason;
ALTER TABLE public.coach_sessions ADD CONSTRAINT ck_coach_sessions_close_reason
    CHECK (close_reason IN ('gap_stated', 'exhausted', 'limit', 'user_ended',
        'actor_finished', 'turn_budget', 'interrupted', 'system_failure'));

ALTER TABLE public.coaching_handoffs
    ADD COLUMN state_revision bigint,
    ADD CONSTRAINT ck_coaching_handoffs_state_revision
        CHECK (state_revision IS NULL OR state_revision >= 0);
CREATE UNIQUE INDEX ux_coaching_handoffs_session_revision
    ON public.coaching_handoffs (coach_session_id, state_revision)
    WHERE state_revision IS NOT NULL;

ALTER TABLE public.coaching_handoffs DROP CONSTRAINT ck_coaching_handoffs_branch_kind;
ALTER TABLE public.coaching_handoffs ADD CONSTRAINT ck_coaching_handoffs_branch_kind
    CHECK (branch_kind IN ('analysis', 'expression', 'coaching'));

ALTER TABLE public.practice_reports DROP CONSTRAINT ck_practice_reports_report_type;
ALTER TABLE public.practice_reports ADD CONSTRAINT ck_practice_reports_report_type
    CHECK (report_type IN ('analysis', 'expression', 'practice_note'));
