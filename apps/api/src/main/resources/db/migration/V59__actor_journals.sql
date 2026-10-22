-- 배우 일지(practice.journal, SOMA-720). 연습 회차마다 한 줄이다.
--
-- 코칭이 끝나면 배우가 고정 질문 4개에 답하고(answers), 서버가 코칭 대화로 자동 칸(draft: 오늘 한 연습·장면과 인물·받은 피드백)을
-- 만든다. 배우의 답과 AI 칸은 따로 둔다 — 자동 칸을 다시 만들거나 고쳐도 배우의 답을 덮어쓰지 않는다.
-- answers·draft 는 JSON 글이다. draft 는 아직 없거나(pending) 만들지 못했거나(failed) 대화가 없어 만들지 않았으면(skipped) NULL 이다.
-- edited_at 은 배우가 일지를 고친 때다. 고친 뒤에는 늦게 끝난 자동 칸 생성이 고친 것을 덮지 않는다.
-- 회차·사람이 지워지면 함께 지워진다(ON DELETE CASCADE). 대화가 지워지면 연결만 끊긴다. 탈퇴의 연습 파기도 이 표를 지운다.
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.actor_journals (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES public.coach_conversations(id) ON DELETE SET NULL,
    answers text NOT NULL,
    draft text,
    draft_status text NOT NULL,
    model text,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_actor_journals_practice UNIQUE (practice_id),
    CONSTRAINT ck_actor_journals_draft_status CHECK (draft_status IN ('pending', 'ready', 'failed', 'skipped'))
);

CREATE INDEX ix_actor_journals_user ON public.actor_journals (user_id, created_at DESC);
