-- 리딩 회차의 「멈춤(stopped)」을 없앤다 (reading.session).
--
-- 같은 대본에 새 연습을 시작해도 진행 중 회차를 닫지 않는다. 그래서 회차 상태는 in_progress·completed 둘이고
-- 한 대본에 진행 중 회차가 여럿일 수 있다 — 대본당 하나를 지키던 부분 유일 인덱스를 지운다.
-- 멈춘 회차는 멈춘 줄(current_line_id)을 그대로 갖고 있어 진행 중으로 옮기면 그 줄부터 이어 할 수 있다.
-- updated_at 은 건드리지 않는다 — 대본 카드의 「마지막 연습」이 이 이관 시각으로 바뀌지 않게.
--
-- 인덱스를 먼저 지워야 한다. 같은 대본에 진행 중 회차가 이미 있으면 옮기는 UPDATE 가 그 인덱스에 걸린다.
--
-- 되돌리기: 이 판보다 앞선 서버는 새 연습을 시작할 때 열린 회차를 'stopped' 로 바꾸므로, 이 CHECK 아래에서는
-- 열린 회차가 있는 대본의 시작이 500 이다. 진행 중 회차가 둘 이상인 대본의 상세도 옛 서버에서는 500 이다
-- (open_session_id 하위 질의가 두 행을 받는다). 이 판 앞으로 이미지를 되돌리지 않고 고쳐서 다시 배포한다.
DROP INDEX public.uq_reading_sessions_open_script;

UPDATE public.reading_sessions SET status = 'in_progress' WHERE status = 'stopped';

ALTER TABLE public.reading_sessions DROP CONSTRAINT ck_reading_sessions_status;
ALTER TABLE public.reading_sessions ADD CONSTRAINT ck_reading_sessions_status
    CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text])));
