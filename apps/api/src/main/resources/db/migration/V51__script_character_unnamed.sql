-- 이름 없는 독백의 임시 배역 표시 (reading.script 「독백」, SOMA-597). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 배역 이름 표기가 없는 한 사람의 글을 나누기 작업이 「화자」라는 임시 이름으로 저장할 때 true 다. 앱은 이 표시를 보고 배우에게 이름을
-- 묻고, 이름을 고치면 false 가 된다. 기본값이 있어 이 칸을 모르는 옛 서버의 INSERT 도 통하고 옛 대본은 false 다.
ALTER TABLE public.script_characters ADD COLUMN unnamed boolean DEFAULT false NOT NULL;
