-- 발음 보고서 채점 진행(SOMA-1171). 일꾼이 채점 서비스에 보낼 줄 수(progress_total)와 그중 끝낸 줄 수(progress_done)를
-- 줄마다 적고, 조회는 running 일 때 이 둘을 내준다 — 긴 대본은 채점이 몇 분 걸려 앱이 진행 막대를 그린다.
-- 집을 때(임대 적기) 비운다. 더하기만 하는 변경이다 — 직전 판 API 는 이 칸을 모르고 쓰지 않는다.
ALTER TABLE public.reading_pronunciation_reports
    ADD COLUMN progress_done integer,
    ADD COLUMN progress_total integer;
