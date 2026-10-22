-- 배우 기억을 배우 단위와 장면 단위로 나눈다 (SOMA-795, practice.memory).
--
-- 1) scene_root_id: 장면 단위 칸(goal·avoid)이 어느 장면(practices.root_id)의 것인지. 배우 단위 칸은 NULL 이다.
--    코치는 같은 root 의 회차에서만 장면 단위 칸을 읽는다 — 한 대본의 인물 목표·"아버지에게서…" 같은 정정이
--    다른 대본의 코칭에 섞이던 것을 막는다.
-- 2) 유일 키를 (user_id, field) 에서 (user_id, field, scene_root_id) 로 넓힌다. NULL 끼리도 같은 값으로 보아
--    배우 단위 칸은 여전히 사람마다 하나다(NULLS NOT DISTINCT, Postgres 15+).
-- 3) coaching_profile: 자문위원 프롬프트와 같은 모양의 "이 배우에게 맞춘 코칭". 코치만 읽고 배우 화면에는 보이지
--    않는다. 자문위원 파일(park-seunga.txt 등)이 1,800자 안팎이라 이 칸만 2,000자까지 받는다.
--
-- ⚠ 배포 때 운영 행을 고친다: 이미 있는 goal·avoid 행 가운데 출처 회차가 있는 것(배우가 직접 쓴 행은 출처가 NULL 이라
--   제외)의 scene_root_id 를 그 회차의 root_id 로 채운다. 값과 작성자는 그대로다.
ALTER TABLE public.actor_memories ADD COLUMN scene_root_id uuid;
ALTER TABLE public.actor_memories ADD CONSTRAINT actor_memories_scene_root_id_fkey
    FOREIGN KEY (scene_root_id) REFERENCES public.practices(id);

UPDATE public.actor_memories m
SET scene_root_id = p.root_id
FROM public.practices p
WHERE p.id = m.source_practice_id
  AND m.field IN ('goal', 'avoid')
  AND m.scene_root_id IS NULL;

ALTER TABLE public.actor_memories DROP CONSTRAINT uq_actor_memories_user_field;
ALTER TABLE public.actor_memories ADD CONSTRAINT uq_actor_memories_user_field_scene
    UNIQUE NULLS NOT DISTINCT (user_id, field, scene_root_id);

ALTER TABLE public.actor_memories DROP CONSTRAINT ck_actor_memories_field;
ALTER TABLE public.actor_memories ADD CONSTRAINT ck_actor_memories_field
    CHECK ((field = ANY (ARRAY['goal'::text, 'blockage'::text, 'speech_self'::text, 'speech_actual'::text,
                               'wants'::text, 'habits'::text, 'avoid'::text, 'tone'::text,
                               'coaching_profile'::text])));

-- 길이는 두 제약으로 나눈다: 맞춤 코칭 말고는 1,000자, 모든 칸은 2,000자. 한 식에 CASE·AND 를 섞으면 덤프·복원 뒤
-- 모양이 달라져 스키마 대조가 깨진다(V22 참고).
ALTER TABLE public.actor_memories DROP CONSTRAINT ck_actor_memories_value_length;
ALTER TABLE public.actor_memories ADD CONSTRAINT ck_actor_memories_value_length
    CHECK (((char_length(value) <= 1000) OR (field = 'coaching_profile'::text)));
ALTER TABLE public.actor_memories ADD CONSTRAINT ck_actor_memories_value_length_max
    CHECK ((char_length(value) <= 2000));
