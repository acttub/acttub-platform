-- 가입 직후 배우가 직접 답한 "액터브를 처음 어디서 알게 됐어요?" (SOMA-649).
--
-- Airbridge 설치 귀속(user_signup_attributions)은 iOS 추적 거부·스토어 직접 검색·지인 추천을 잡지 못한다
-- (2026-10-09: 10/7 이후 귀속 기록 44건 중 28건이 미귀속). 사람에게 직접 물어 그 빈칸을 보정한다.
-- 귀속과 뜻이 달라(자기 응답 · 기억) 같은 표에 섞지 않고 따로 선다.
--
-- 계정마다 많아야 한 행이고 처음 답만 남는다. source 가 NULL 이면 건너뛰었다는 뜻이다(다시 묻지 않으려고 남긴다).
-- detail 은 인스타그램을 골랐을 때의 세부(광고·공식 게시물·다른 사람 게시물·모름)뿐이다. other_text 는 '기타'에
-- 직접 쓴 30자 이하 글이다 — 자유 입력이라 ops 원장(ops-core)에는 싣지 않는다. 탈퇴 때 행째 지운다
-- (PostgresProfileRepository#withdraw). 계정 행을 지우는 경로는 CASCADE 가 따라 지운다.
CREATE TABLE public.user_discovery_answers (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source text,
    detail text,
    other_text text,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT ck_user_discovery_answers_source CHECK ((source = ANY (ARRAY[
        'instagram'::text, 'naver_search'::text, 'google_youtube'::text, 'app_store_search'::text,
        'friend'::text, 'academy_school'::text, 'community'::text, 'other'::text]))),
    CONSTRAINT ck_user_discovery_answers_detail CHECK ((detail = ANY (ARRAY[
        'ad'::text, 'official_post'::text, 'other_post'::text, 'unknown'::text]))),
    CONSTRAINT ck_user_discovery_answers_detail_source
        CHECK (detail IS NULL OR source = 'instagram'),
    CONSTRAINT ck_user_discovery_answers_other_text
        CHECK (other_text IS NULL OR (source = 'other' AND char_length(other_text) BETWEEN 1 AND 30))
);
