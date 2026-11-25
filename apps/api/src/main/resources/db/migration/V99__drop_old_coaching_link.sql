-- 옛 코칭 연결의 표와 칸을 지운다 (SOMA-1142).
--
-- 지우는 것: handoff_confirmations(넘김의 확인·반박, 운영 70행 모두 confirmed, 반박 글 0), coaching_handoffs.branch_kind·
-- handoff_json(넘김의 갈래·원문), coach_sessions.conversation_summary(채우는 코드가 없어 운영 238행 모두 빈 값). 머지 전에
-- 확인 표 전체와 넘김의 두 칸을 R2 acttub-db-backups 버킷의 archive/2026-11-25-dropped-tables/ 에 남겼다(빈 칸은 빼고).
-- 직전 운영 API 는 이것들을 읽거나 쓰지 않는다 — 호환 읽기와 이관 명령이 읽는
-- coaching_handoffs 의 칸은 id·coach_session_id·state_revision 뿐이다(apps/api/CONTRACT.md §5-1).
--
-- 순서와 잠금: 표를 다시 쓰지 않고 카탈로그만 고친다(운영 행 수로 채운 PostgreSQL 18 에서 문장마다 2ms 안쪽). 확인 표를 먼저
-- 지운다 — 그 외래 키(coaching_handoff_id → coaching_handoffs)가 함께 사라지면서 coaching_handoffs 도 잠긴다. 다음으로
-- 넘김의 두 칸을 지우면 거기 걸린 NOT NULL 과 값 CHECK(ck_coaching_handoffs_branch_kind)가 칸과 함께 사라진다. 마지막으로
-- coach_sessions 의 칸을 지운다. 세 표 모두 옛 연습 흐름이라 붙는 요청이 드물다. 기다림이 5초를 넘으면 실패시킨다 — 새 API 가
-- 뜨지 않고 옛 API 가 그대로 돌며, 다시 배포하면 된다.
SET LOCAL lock_timeout = '5s';

DROP TABLE public.handoff_confirmations;

ALTER TABLE public.coaching_handoffs DROP COLUMN branch_kind, DROP COLUMN handoff_json;

ALTER TABLE public.coach_sessions DROP COLUMN conversation_summary;
