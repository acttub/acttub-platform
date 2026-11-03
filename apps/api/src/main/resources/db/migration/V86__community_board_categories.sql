-- 배우 게시판을 되살리며 분류를 「질문 · 오디션 정보 · 상대역 구함 · 자유」로 바꾸고, 신고 사유를 챌린지와 맞춘다(SOMA-873).
--
-- 분류는 행을 지우거나 끄지 않는다. 옛 글이 가리키는 id 를 그대로 두고 이름만 바꾼다 — 입시 Q&A(admission)는
-- 질문(question)으로, 정보공유(info)는 오디션 정보(audition)로 옮기고, 자유(free)는 그대로 두되 맨 뒤로 보낸다.
-- 상대역 구함(partner)만 새로 넣는다. 옛 글은 바뀐 이름의 분류 아래 그대로 보인다.
--
-- 신고 사유 CHECK 는 넓히기만 한다. 옛 값(spam·abuse·sexual·privacy·other)은 그대로 통하고 챌린지의 사유
-- (copyright·inappropriate·duplicate)를 더한다. 직전 운영 서버는 게시판 코드가 없어 이 표를 읽지 않으므로
-- 되돌려도 그대로 뜬다.

UPDATE public.community_categories
SET slug = 'question',
    name = '질문',
    description = '연기·입시·오디션 준비하다 막힌 것 묻기',
    sort_order = 10,
    is_active = TRUE
WHERE slug = 'admission';

UPDATE public.community_categories
SET slug = 'audition',
    name = '오디션 정보',
    description = '오디션·공연·촬영 공고와 다녀온 후기',
    sort_order = 20,
    is_active = TRUE
WHERE slug = 'info';

INSERT INTO public.community_categories (slug, name, description, sort_order, is_active)
VALUES ('partner', '상대역 구함', '같이 맞춰 볼 상대역·스터디 찾기', 30, TRUE)
ON CONFLICT (slug) DO NOTHING;

UPDATE public.community_categories
SET name = '자유',
    description = '연습하다 든 생각, 근황, 잡담',
    sort_order = 40,
    is_active = TRUE
WHERE slug = 'free';

ALTER TABLE public.community_reports DROP CONSTRAINT ck_community_reports_reason;
ALTER TABLE public.community_reports ADD CONSTRAINT ck_community_reports_reason CHECK ((reason = ANY (ARRAY[
    'spam'::text, 'abuse'::text, 'sexual'::text, 'privacy'::text, 'other'::text,
    'copyright'::text, 'inappropriate'::text, 'duplicate'::text])));
