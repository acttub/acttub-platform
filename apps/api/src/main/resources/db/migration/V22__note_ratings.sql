-- 연습 노트 평가 (practice.note, SOMA-558). 넓히기만 한다 — 옛 표와 1.0.0 표의 모양은 그대로다.
--
--    노트 하나에 사람 하나가 한 행이고 다시 누르면 덮어쓴다(`uq_note_ratings_note_user`). 한 줄(`comment`)은 선택이고
--    같은 행에 붙는다 — 앞뒤 공백을 걷은 1~100자이고 비었으면 NULL 이다. `request_id` 는 마지막으로 반영한 요청의
--    id 다: 같은 id 의 재전송은 같은 답을, 다른 본문은 422 request_fingerprint_mismatch 를 받는다(행이 덮어쓰이므로
--    지문 칸을 따로 두지 않고 저장된 값과 견준다).
--
--    `note_id` 는 1.0.0 노트(`coach_notes`)만 가리킨다. 아직 옮기지 않은 옛 노트(`practice_reports`)는 평가를 받지
--    않는다(404 note_not_found). `practice_id` 는 노트에서 대화를 거쳐 나오는 값이지만 회차 단위로 찾고 이관·탈퇴를
--    따라가게 둔다. 탈퇴하면 한 줄을 비우고 평가 값은 사람과 끊어 남긴다(CONTRACT §6-8).
CREATE TABLE public.note_ratings (
    id uuid NOT NULL,
    practice_id uuid NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating text NOT NULL,
    comment text,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT note_ratings_pkey PRIMARY KEY (id),
    CONSTRAINT note_ratings_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id),
    CONSTRAINT note_ratings_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.coach_notes(id),
    CONSTRAINT note_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT uq_note_ratings_note_user UNIQUE (note_id, user_id),
    CONSTRAINT ck_note_ratings_rating
        CHECK ((rating = ANY (ARRAY['helpful'::text, 'not_helpful'::text]))),
    CONSTRAINT ck_note_ratings_comment
        CHECK ((comment IS NULL) OR ((char_length(comment) BETWEEN 1 AND 100) AND (btrim(comment) <> ''::text)))
);

-- 이관과 탈퇴가 사람 단위로 찾는다.
CREATE INDEX idx_note_ratings_user ON public.note_ratings USING btree (user_id);
