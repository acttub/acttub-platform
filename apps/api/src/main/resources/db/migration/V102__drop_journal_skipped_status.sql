-- 배우 일지의 자동 칸 생성 상태에서 쓰지 않는 skipped 를 CHECK 에서 뺀다 (SOMA-1174).
--
-- 대화가 없는 일지를 skipped 대신 ready 로 닫는 코드(SOMA-1130)가 운영에 나갔다. 그래서 직전 운영 API 도
-- 이 값을 쓰지 않는다. 그 배포가 옛 skipped 행을 ready 로 읽던 줄은 이 변경에서 지운다.
--
-- 행은 고치지 않는다. 2026-11-27 운영·dev 집계에서 actor_journals 의 skipped 행은 0 이다. 그 값의 행이 있으면 아래
-- ADD CONSTRAINT 가 실패해 새 API 가 뜨지 않고 옛 API 가 그대로 돈다.
--
-- 잠금: CHECK 를 더하는 동안 actor_journals 에 ACCESS EXCLUSIVE 를 잡고 행을 한 번 훑는다. 기다림이 5초를 넘으면 실패시킨다 —
-- 새 API 가 뜨지 않고 옛 API 가 그대로 돌며, 다시 배포하면 된다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.actor_journals DROP CONSTRAINT ck_actor_journals_draft_status;
ALTER TABLE public.actor_journals ADD CONSTRAINT ck_actor_journals_draft_status
    CHECK ((draft_status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])));
