-- 배우 기억(유저.md) 칸 개정 (SOMA-603, practice.memory).
--
-- 코치에게 바라는 것(wants)·자주 짚인 버릇(habits)·다시 말하지 않을 것(avoid)·말투(tone)를 더한다.
-- 옛 화법 두 칸(speech_self·speech_actual)은 행을 지우지 않는다 — 스토어에 나간 앱이 아직 그 칸을 보여 준다.
-- 칸 이름의 정본은 MemoryField 이고 ValueCheckCatalogIT 가 이 목록과 맞춰 본다.
ALTER TABLE public.actor_memories DROP CONSTRAINT ck_actor_memories_field;
ALTER TABLE public.actor_memories ADD CONSTRAINT ck_actor_memories_field
    CHECK ((field = ANY (ARRAY['goal'::text, 'blockage'::text, 'speech_self'::text, 'speech_actual'::text,
                               'wants'::text, 'habits'::text, 'avoid'::text, 'tone'::text])));
