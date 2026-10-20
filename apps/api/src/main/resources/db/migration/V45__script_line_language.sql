-- 대사 줄의 말과 소리 낼 글 (reading.script 「줄별 말」, SOMA-751). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 대본 나누기 뒤 외국 글자가 든 대사만 모델에 보내 그 줄이 어느 말인지(lang, ISO 639-1 두 글자)와 상대역 목소리가
-- 읽을 글(speech)을 받는다. 예: 로마자로 적은 시리아 아랍어 "3anni ana? 안니 아나?" → lang 'ar', speech 는 아랍 문자.
-- 모르거나 한국어면 NULL 이고 앱은 지금처럼 읽는다. 줄 글을 고치면 두 칸을 비운다.
-- NULL 허용 칸만 더하므로 옛 서버는 그대로 돈다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.script_lines ADD COLUMN lang text;
ALTER TABLE public.script_lines ADD COLUMN speech text;
