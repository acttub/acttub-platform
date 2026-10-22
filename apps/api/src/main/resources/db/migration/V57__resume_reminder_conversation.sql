-- 같은 대화를 다시 쉬더라도 마저 하기 알림은 한 번만 보낸다. 기존 서버와 호환되는 nullable 확장이다.
ALTER TABLE public.practice_reminder_sends ADD COLUMN conversation_id uuid;
CREATE UNIQUE INDEX uq_practice_reminder_resume_conversation ON public.practice_reminder_sends (conversation_id) WHERE conversation_id IS NOT NULL;
