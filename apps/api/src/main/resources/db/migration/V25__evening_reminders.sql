ALTER TABLE public.push_tokens ADD COLUMN app_version text;

CREATE TABLE public.evening_reminder_sends (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    day date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, day)
);
