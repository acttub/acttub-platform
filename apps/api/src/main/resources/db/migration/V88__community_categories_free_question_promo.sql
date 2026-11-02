-- 게시판 분류를 「자유 · 질문 · 홍보」 셋으로 줄인다(11/2 폰 QA). 글쓰기 기본 분류는 자유다(앱).
--
-- 행은 지우지 않는다(V86 과 같은 원칙). 오디션 정보(audition)에 있던 글은 홍보(promo)로, 상대역 구함(partner)에
-- 있던 글은 자유(free)로 옮기고, 두 분류는 끈다(is_active = FALSE). 꺼진 분류는 목록·글쓰기에 나오지 않는다.

INSERT INTO public.community_categories (slug, name, description, sort_order, is_active)
VALUES ('promo', '홍보', '공연·작품·스터디 홍보와 모집', 30, TRUE)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_active = TRUE;

UPDATE public.community_categories SET sort_order = 10, is_active = TRUE WHERE slug = 'free';
UPDATE public.community_categories SET sort_order = 20, is_active = TRUE WHERE slug = 'question';

UPDATE public.community_posts
SET category_id = (SELECT id FROM public.community_categories WHERE slug = 'promo')
WHERE category_id = (SELECT id FROM public.community_categories WHERE slug = 'audition');

UPDATE public.community_posts
SET category_id = (SELECT id FROM public.community_categories WHERE slug = 'free')
WHERE category_id = (SELECT id FROM public.community_categories WHERE slug = 'partner');

UPDATE public.community_categories SET is_active = FALSE, sort_order = 90 WHERE slug IN ('audition', 'partner');
