-- 푸시 알림을 눌러 앱을 연 기록. 보낸 기록(practice_reminder_sends.template_id·kind, notifications.kind)과 이어
-- "푸시로 돌아온 사람"을 재기 위한 것이다. 더하기만 하는 변경이다: 새 테이블 하나, 옛 서버는 모르고도 그대로 돈다.
-- kind 는 푸시 data.kind 그대로(evening_reminder·analysis_complete·entry_liked 등, 모르는 값은 'unknown').
-- reminder_kind·template_id 는 연습 알림일 때만 채운다.
CREATE TABLE public.push_opens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    reminder_kind text,
    template_id text,
    platform text,
    app_version text,
    opened_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_push_opens_user_opened ON public.push_opens (user_id, opened_at);
CREATE INDEX idx_push_opens_opened ON public.push_opens (opened_at);
