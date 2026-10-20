-- 코칭 세션 목적 (practice.start 「세션 목적」, SOMA-719). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 앱이 코칭을 시작할 때 고른 목적이다: 평가 받기(evaluate) · 막힌 곳 풀기(stuck) · 인물 이해하기(character).
-- 이어하기는 묶음 첫 회차의 목적을 물려받는다. 목적을 보내지 않는 옛 클라이언트의 회차는 NULL 이고 코치는 지금 그대로다.
-- NULL 허용 칸 하나와 그 값의 CHECK 만 더하므로 이 칸을 모르는 옛 서버의 INSERT 도 통한다.
ALTER TABLE public.practices ADD COLUMN session_purpose text;
ALTER TABLE public.practices ADD CONSTRAINT ck_practices_session_purpose
    CHECK (session_purpose IN ('evaluate', 'stuck', 'character'));
