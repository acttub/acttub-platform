-- SOMA-791 리딩 녹음으로 시작하는 코칭. 묶음 첫 회차가 어느 리딩 회차의 녹음으로 시작했는지 남긴다.
-- 리딩 회차를 지우면 연결만 끊긴다(코칭 기록은 남는다). 리딩 회차 하나에 이 코칭은 하나다.
ALTER TABLE public.practices
    ADD COLUMN reading_session_id uuid REFERENCES public.reading_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX practices_reading_session_uq ON public.practices (reading_session_id)
    WHERE reading_session_id IS NOT NULL;
-- 그 회차의 목적은 서버가 reading 으로 둔다(앱이 고르지 않는다).
ALTER TABLE public.practices DROP CONSTRAINT ck_practices_session_purpose;
ALTER TABLE public.practices ADD CONSTRAINT ck_practices_session_purpose
    CHECK (session_purpose IN ('evaluate', 'stuck', 'character', 'concern', 'reading'));

-- 예전 실험(리딩 녹음 코치 두 차례, V48)은 이 코칭으로 바뀌었다. 운영에서는 스위치가 꺼져 있어 행이 없다.
DROP TABLE IF EXISTS public.reading_recording_coaches;
