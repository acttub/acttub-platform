-- 코치 대화 종료 사유에서 쓰지 않는 gap_stated 를 CHECK 에서 뺀다 (SOMA-1130).
--
-- 지금 코드와 운영 코드(main) 모두 이 값을 만들지 않는다. 신형 엔진의 종료 사유는 actor_finished·turn_budget·interrupted·
-- system_failure 이고(three-layer-contracts.schema.json), 옛 대화를 옮기는 명령은 gap_stated 를 exhausted 로 바꾼다.
-- 옛 표 coach_sessions 의 값 목록은 그대로 둔다(옛 표 정리는 따로 한다).
--
-- 행은 고치지 않는다. 2026-11-24 운영 집계에서 coach_conversations 의 gap_stated 행은 0 이다. 그 값의 행이 있으면 아래
-- ADD CONSTRAINT 가 실패해 새 API 가 뜨지 않고 옛 API 가 그대로 돈다.
ALTER TABLE public.coach_conversations DROP CONSTRAINT ck_coach_conversations_close_reason;
ALTER TABLE public.coach_conversations ADD CONSTRAINT ck_coach_conversations_close_reason
    CHECK ((close_reason = ANY (ARRAY['exhausted'::text, 'limit'::text, 'user_ended'::text, 'system_failure'::text])));
