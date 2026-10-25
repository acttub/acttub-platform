-- 영상 없이 말로 하는 코칭 (practice.start 「영상 없이」, SOMA-745). 넓히기만 한다 — 옛 표의 모양은 그대로다.
--
-- 영상 없이 시작한 회차는 video_id 가 NULL 이고 세션 목적이 막힌 곳 풀기(stuck)·인물 이해하기(character)·고민 상담(concern)
-- 중 하나다. 이 짝은 서버(PracticeService)가 지킨다. 고민 상담(concern)은 영상 없는 회차에만 쓴다.
-- NOT NULL 을 푸는 것과 CHECK 에 값 하나를 더하는 것뿐이라 이 칸을 모르는 옛 서버의 INSERT·SELECT 도 그대로 통한다.
ALTER TABLE public.practices ALTER COLUMN video_id DROP NOT NULL;
ALTER TABLE public.practices DROP CONSTRAINT ck_practices_session_purpose;
ALTER TABLE public.practices ADD CONSTRAINT ck_practices_session_purpose
    CHECK (session_purpose IN ('evaluate', 'stuck', 'character', 'concern'));
