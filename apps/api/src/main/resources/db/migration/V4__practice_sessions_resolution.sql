-- 배우가 대화를 마친 뒤 처음 막혔던 지점이 지금은 어떤지 스스로 답한 것 (SOMA-466).
--
-- 점수를 주지 않는 제품이라 "좋아졌다"를 서버가 판정하지 않는다. 대신 배우에게 한 번 묻고
-- 그 답을 연습에 남긴다 — 막힘 해결률의 원본이고, 다음 연습의 코치 첫 질문 재료다.
-- 값은 셋뿐이다: resolved(풀렸다) · partly(조금 풀렸다) · same(그대로). 건너뛰면 NULL.
ALTER TABLE public.practice_sessions
    ADD COLUMN resolution_self_report text,
    ADD COLUMN resolution_note text;

ALTER TABLE public.practice_sessions
    ADD CONSTRAINT ck_practice_sessions_resolution_self_report
    CHECK (resolution_self_report IS NULL
        OR resolution_self_report = ANY (ARRAY['resolved', 'partly', 'same']));
