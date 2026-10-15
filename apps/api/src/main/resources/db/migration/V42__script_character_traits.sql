-- 배역의 성별·나이대 (reading.cast 「자동 목소리」, SOMA-670). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 나누기 작업이 모델 답(긴 대본은 배역 목록 호출, 짧은 대본은 나누기 호출 끝의 「배역」 블록)에서 읽어 대본을 저장할 때
-- 함께 쓴다. 호출을 늘리지 않는다. 모르면 NULL 이고, 예시·기기가 나눈 대본도 NULL 이다. 자동 목소리(voice_preset NULL)가
-- 이 값으로 프리셋을 고른다. 값은 API 값과 같다(gender m·f, age_band child·young·adult·senior).
-- NULL 허용 칸만 더하므로 옛 서버는 그대로 돈다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.script_characters ADD COLUMN gender text;
ALTER TABLE public.script_characters ADD COLUMN age_band text;
ALTER TABLE public.script_characters ADD CONSTRAINT ck_script_characters_gender
    CHECK ((gender = ANY (ARRAY['m'::text, 'f'::text])));
ALTER TABLE public.script_characters ADD CONSTRAINT ck_script_characters_age_band
    CHECK ((age_band = ANY (ARRAY['child'::text, 'young'::text, 'adult'::text, 'senior'::text])));
