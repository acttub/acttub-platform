-- 새 연습이 어느 연습의 대화를 이어받는지 (SOMA-417).
--
-- 배우가 끝난 연습의 카드에서 "이어서 새 연습" 을 누르면 그 연습의 id 가 여기 실리고,
-- 코치는 시작·답변 턴마다 이 연습의 대화 발췌를 싣는다. 비어 있으면 지금처럼 가장 최근
-- 대화를 이어받는다. 요청 한 번에만 실어 보내면 답변 턴이 발췌를 다시 만들 때 고른
-- 연습을 잊어버리므로, 선택은 연습의 속성으로 남긴다.
ALTER TABLE public.practice_sessions
    ADD COLUMN continued_from uuid REFERENCES public.practice_sessions(id) ON DELETE SET NULL;
