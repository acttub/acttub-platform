-- 함께 말하는 줄의 묶음 배역 (reading.script 「배역 묶기」, SOMA-709). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 나누기 작업이 「지해, 연수」처럼 이 대본의 다른 배역 이름만으로 된 화자(「모두」는 모든 배역)를 묶음 배역으로 저장하고,
-- 그 줄을 함께 말하는 배역들의 id 를 남긴다. 보통 배역과 옛 대본은 NULL 이다. 줄은 지금처럼 묶음 배역에 매달리므로
-- 옛 서버·옛 앱은 이 칸을 모른 채 묶음 배역을 보통 배역처럼 다룬다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.script_characters ADD COLUMN member_ids uuid[];
ALTER TABLE public.script_characters ADD CONSTRAINT ck_script_characters_member_ids
    CHECK (((member_ids IS NULL) OR (cardinality(member_ids) >= 2)));
