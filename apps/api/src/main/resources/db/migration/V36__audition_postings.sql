-- 오디션 공고 모아보기 (SOMA-564, app.audition, ADR-034).
--
-- 서버가 공개 출처의 목록 페이지·RSS 에서 하루 두 번 모은 공고의 사실 항목만 둔다. 본문 전문·포스터·작성자·담당자
-- 이름·연락처는 칸이 없다. 같은 (source, source_ref) 는 한 행이고 다시 모으면 칸을 새 값으로 갱신한다.
-- 상태 칸은 두지 않는다 — 열림은 읽을 때 계산하고, 끝 상태는 수집 끝의 삭제다.
CREATE TABLE public.audition_postings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL,
    source_ref text NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    pay_text text,
    apply_start date,
    apply_end date,
    status_text text,
    posted_on date NOT NULL,
    source_url text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    CONSTRAINT uq_audition_postings_source_ref UNIQUE (source, source_ref),
    CONSTRAINT ck_audition_postings_source CHECK (source IN ('shinsee', 'emk', 'sejong', 'plfil', 'otr')),
    CONSTRAINT ck_audition_postings_category CHECK (category IN (
        'film', 'short_film', 'drama', 'web_drama', 'short_form', 'commercial', 'music_video', 'theater', 'musical',
        'agency_open', 'other')),
    CONSTRAINT ck_audition_postings_source_url CHECK (source_url LIKE 'https://%')
);

-- 열림 조회: 마감일이 오늘 이후이거나, 마감일이 없고 게시일이 45일 안인 행. 삭제도 같은 두 칸으로 고른다.
CREATE INDEX idx_audition_postings_apply_end ON public.audition_postings (apply_end) WHERE apply_end IS NOT NULL;
CREATE INDEX idx_audition_postings_posted_on_without_end
    ON public.audition_postings (posted_on) WHERE apply_end IS NULL;
