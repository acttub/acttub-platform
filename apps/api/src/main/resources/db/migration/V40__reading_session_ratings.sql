-- 리딩 회차 평가 (reading.session, SOMA-661). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
--    "이번 리딩 어땠나요?" 의 좋았어요·아쉬웠어요다. 노트 평가(V22 `note_ratings`)와 같은 모양이다. 회차 하나에 사람
--    하나가 한 행이고 다시 누르면 덮어쓴다(`uq_reading_session_ratings_session_user`). 한 줄(`comment`)은 선택이고
--    같은 행에 붙는다 — 앞뒤 공백을 걷은 1~100자이고 비었으면 NULL 이다. `request_id` 는 마지막으로 반영한 요청의
--    id 다: 같은 id 의 재전송은 같은 답을, 다른 본문은 422 request_fingerprint_mismatch 를 받는다(행이 덮어쓰이므로
--    지문 칸을 따로 두지 않고 저장된 값과 견준다).
--
--    회차에 매달린 리딩 자료라 리딩 표를 따른다(specs/reading 「리딩 자료의 이관·삭제·탈퇴」): 이관은 회차와 함께
--    주인을 바꾸고, 회차 삭제·대본 삭제·탈퇴는 회차보다 먼저 행째 지운다. FK 에 ON DELETE 가 없는 것도 리딩 표들과
--    같다 — 지우는 순서는 애플리케이션이 정한다.
CREATE TABLE public.reading_session_ratings (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating text NOT NULL,
    comment text,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_session_ratings_pkey PRIMARY KEY (id),
    CONSTRAINT reading_session_ratings_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.reading_sessions(id),
    CONSTRAINT reading_session_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT uq_reading_session_ratings_session_user UNIQUE (session_id, user_id),
    CONSTRAINT ck_reading_session_ratings_rating
        CHECK ((rating = ANY (ARRAY['good'::text, 'bad'::text]))),
    -- 한 줄은 NULL 이거나 공백만이 아닌 1~100자다. CHECK 는 NULL 을 통과시키므로 조건을 하나씩 나눈다 —
    -- OR·AND 를 섞은 식은 덤프·복원 뒤 괄호 모양이 달라져 스키마 대조(smoke)가 깨진다.
    CONSTRAINT ck_reading_session_ratings_comment_length CHECK (char_length(comment) BETWEEN 1 AND 100),
    CONSTRAINT ck_reading_session_ratings_comment_not_blank CHECK ((btrim(comment) <> ''::text))
);

-- 이관과 탈퇴가 사람 단위로 찾는다.
CREATE INDEX idx_reading_session_ratings_user ON public.reading_session_ratings USING btree (user_id);
