-- 코드가 읽고 쓰지 않는 옛 표·칸을 지운다 (SOMA-1142).
--
-- 지우는 것: 광고 옛 칸 셋(#1134 에서 코드가 빠짐), 구형 reports(옛 연습 노트는 practice_reports·coach_notes 가 갖는다),
-- summaries 의 옛 칸 다섯, practice_sessions.subtext, users.role. 값은 보관하지 않는다(2026-11-25 결정). 직전 운영 API 는
-- 이것들을 읽거나 쓰지 않고 엔티티 매핑도 없어서, ddl-auto: validate 도 이 칸을 찾지 않는다(apps/api/CONTRACT.md §5-1).
--
-- 잠금: 칸 지우기는 표를 다시 쓰지 않고 카탈로그만 고친다(운영 행 수로 채운 PostgreSQL 18 에서 문장마다 3ms 안쪽). 대신 표마다
-- ACCESS EXCLUSIVE 를 잡아 커밋까지 쥔다. reports 를 지우면 그 외래 키(session_id → coach_sessions)가 함께 사라지면서
-- coach_sessions 도 잠긴다. 가장 붐비는 users 를 맨 끝에 둬서, users 를 기다리는 동안 쥐고 있는 잠금이 옛 표와 ads 뿐이게
-- 한다. 기다림이 5초를 넘으면 실패시킨다 — 새 API 가 뜨지 않고 옛 API 가 그대로 돌며, 다시 배포하면 된다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ads DROP COLUMN academy_registration_no, DROP COLUMN course_name, DROP COLUMN tuition;

DROP TABLE public.reports;

ALTER TABLE public.summaries DROP COLUMN observation, DROP COLUMN summary, DROP COLUMN intent_alignment,
    DROP COLUMN key_moment, DROP COLUMN key_dimension;

ALTER TABLE public.practice_sessions DROP COLUMN subtext;

-- 값 CHECK(ck_users_role)와 NOT NULL 은 칸과 함께 사라진다.
ALTER TABLE public.users DROP COLUMN role;
