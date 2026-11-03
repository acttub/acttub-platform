-- 연습 삭제(practice.library 「연습 삭제」, SOMA-985). 배우가 묶음을 지우면 그 묶음의 회차·노트·대화는
-- 「지운 연습 보관 계정」(행은 첫 삭제 때 만든다)으로 옮겨 사람과 끊어 남기고, 영상은 보관 동의자 것만 남긴다.
--
-- 더하기만 하는 변경이다: 새 테이블 둘. 직전 운영 서버는 이 테이블을 모르고 되돌려도 그대로 뜬다.

-- 지운 회차의 시각만 남긴다 — 회차가 계정을 떠나도 오늘 쓴 무료 코칭 횟수에서 빠지지 않게 한다.
-- 어떤 회차였는지는 적지 않는다(사람과 끊은 기록을 다시 잇지 않는다). 40일 지나면 정리 작업이 지운다.
CREATE TABLE public.practice_deletion_marks (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    practice_created_at timestamp with time zone NOT NULL,
    from_reading boolean NOT NULL,
    deleted_at timestamp with time zone NOT NULL,
    CONSTRAINT practice_deletion_marks_pkey PRIMARY KEY (id),
    CONSTRAINT practice_deletion_marks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_practice_deletion_marks_user ON public.practice_deletion_marks USING btree (user_id, practice_created_at);

-- 보관 동의자가 지운 연습의 영상. 영상 행은 보관 계정으로 옮겨 배우의 보관함에서 빠지고, 이 장부가 원래
-- 주인과 지운 시각을 든다 — 지운 날부터 3년이 지나거나 원래 주인이 보관 동의를 거절로 바꾸면 파일을 파기한다.
CREATE TABLE public.deleted_practice_videos (
    video_id uuid NOT NULL,
    user_id uuid NOT NULL,
    deleted_at timestamp with time zone NOT NULL,
    CONSTRAINT deleted_practice_videos_pkey PRIMARY KEY (video_id),
    CONSTRAINT deleted_practice_videos_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE,
    CONSTRAINT deleted_practice_videos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_deleted_practice_videos_user ON public.deleted_practice_videos USING btree (user_id);
