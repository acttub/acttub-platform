-- 입시 준비 배우 첫 화면(SOMA-864)을 뺀다. V71 은 dev DB 에 이미 들어가 있어 파일을 지우지 않고 여기서 되돌린다.
-- 입시 예시 3개(exam-result·exam-brother·exam-studio)를 지우고, V71 이 더한 두 칸(reading_examples.category,
-- user_profiles.exam_date)을 뺀다. 예시를 이미 복사해 간 대본은 scripts 에 따로 있어 그대로 남는다.
-- 운영에는 V71 이 아직 안 들어갔다. 운영은 V71 과 이 판을 한 번에 지나가 V70 뒤와 같은 모양이 된다.
DELETE FROM public.reading_examples WHERE id IN ('exam-result', 'exam-brother', 'exam-studio');
ALTER TABLE public.reading_examples DROP COLUMN IF EXISTS category;
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS exam_date;
