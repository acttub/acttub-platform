-- 리딩 녹음 코치(SOMA-791, 실험·기본 꺼짐)의 대화. 리딩 회차마다 한 줄이다.
--
-- 회차의 내 대사 녹음으로 코치가 두 차례 답한다: 첫 차례(들린 것 하나 + 대본 질문)와 배우 답을 받은 둘째 차례(영상 권유).
-- first_design 은 모델이 배우에게 보이지 않게 쓴 숨은 칸이며 운영 검토용으로만 남긴다. focus_line_id 는 코치가 고른 녹음의 줄이고
-- 대본을 고치면 사라질 수 있어 FK 를 걸지 않는다.
-- 회차·사람이 지워지면 함께 지워진다(ON DELETE CASCADE). 탈퇴의 리딩 파기는 reading_sessions 를 지우므로 대화도 함께 지워진다.
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.reading_recording_coaches (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reading_session_id uuid NOT NULL REFERENCES public.reading_sessions(id) ON DELETE CASCADE,
    model text NOT NULL,
    clip_count integer NOT NULL,
    first_design text,
    first_message text NOT NULL,
    focus_line_id uuid,
    actor_reply text,
    second_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_reading_recording_coaches_session UNIQUE (reading_session_id)
);

CREATE INDEX ix_reading_recording_coaches_user ON public.reading_recording_coaches (user_id, created_at DESC);
