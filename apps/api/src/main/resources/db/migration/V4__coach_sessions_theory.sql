-- 배우가 세션 시작 때 고른 연기 접근법. 고르지 않으면 NULL 이고, 그때는 기존 코치 그대로 돈다.
-- 값은 프롬프트 리소스 파일 이름(coach/theory/*.txt)과 같다 — 서버가 그 이름으로 은행을 읽는다.
ALTER TABLE coach_sessions ADD COLUMN theory text;

COMMENT ON COLUMN coach_sessions.theory IS
    '배우가 고른 연기 접근법. NULL 이면 접근법 없이 진행한다.';
