-- 공개 참여작 AI 검사 (SOMA-907). 공개 참여작은 지금처럼 바로 보이고, 올라간 직후 워커가 영상·캡션을 모델에 보여
-- 판정한다. 숨김 판정은 참여작을 신고 숨김으로 돌리고 신고 목록에 AI 신고를 남긴다.
--
-- moderation_status: NULL(검사 대상 아님 — 비공개였거나 이 기능 전), pending(검사 차례), passed(통과),
-- flagged(숨김 판정), review(애매 — 보이게 두고 운영 확인), failed(시도 상한까지 실패 — 보이게 두고 운영 확인).
-- 직전 판 API 는 이 열을 모르고 넣으므로 기본값(NULL)이 그 상태다.
ALTER TABLE public.challenge_entries
    ADD COLUMN moderation_status text,
    ADD COLUMN moderation_attempts integer DEFAULT 0 NOT NULL,
    ADD COLUMN moderation_model text,
    ADD COLUMN moderated_at timestamp with time zone,
    ADD CONSTRAINT ck_challenge_entries_moderation_status
        CHECK (moderation_status IN ('pending', 'passed', 'flagged', 'review', 'failed')),
    ADD CONSTRAINT ck_challenge_entries_moderation_attempts
        CHECK (moderation_attempts >= 0);

-- 검사 워커가 오래된 순으로 집는다.
CREATE INDEX ix_challenge_entries_moderation_pending ON public.challenge_entries (created_at, id)
    WHERE moderation_status = 'pending';

-- 이미 공개된 참여작도 한 번 검사한다.
UPDATE public.challenge_entries SET moderation_status = 'pending'
    WHERE visibility = 'public' AND status = 'visible' AND deleted_at IS NULL;

-- AI 신고는 신고자가 사람이 아니다. 사람 신고만 reporter_id 를 갖는다. 직전 판 API 는 source 를 모르고 넣으므로
-- 기본값이 사람 신고다.
ALTER TABLE public.entry_reports
    ALTER COLUMN reporter_id DROP NOT NULL,
    ADD COLUMN source text DEFAULT 'user' NOT NULL,
    ADD CONSTRAINT ck_entry_reports_source CHECK (source IN ('user', 'ai')),
    ADD CONSTRAINT ck_entry_reports_source_reporter CHECK ((source = 'ai') = (reporter_id IS NULL));
