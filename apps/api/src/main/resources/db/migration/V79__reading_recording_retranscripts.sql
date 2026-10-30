-- 리딩 녹음 서버 다시 받아쓰기 — 기기 음성 인식이 아무것도 받아쓰지 못한 줄 녹음을 서버가 뒤에서 다시 받아쓰는 작업 큐.
--
-- 기기 인식기는 배우가 첫마디를 늦게 시작하면 「말 없음」으로 일찍 꺼지거나, 목소리가 들어 있어도 빈 결과를 낸다
-- (2026-10-30 최근 7일 줄 녹음의 24% 가 빈 전사). 그런 녹음 가운데 소리가 들어 있는 것만 서버 받아쓰기 모델로 다시 받아써
-- reading_recordings.transcript·matched 를 채운다. 리딩 진행(자동 넘김)은 기기에서 이미 끝났으므로 배우가 기다리는 일은 없다.
--
-- 녹음 하나 = 행 하나. object_key 는 줄 세운 그 녹음이다 — 기기가 같은 줄을 다시 올려 녹음이 바뀌면 행을 다시 줄 세우고,
-- 처리할 때 녹음의 object_key 와 다르면(또는 이미 전사가 있으면) 건너뛴다.
-- status: queued → running → done(채웠다) | silent(소리가 작아 보내지 않았다) | empty(모델도 글이 없었다) | stale(녹음이 바뀌었다)
--         | too_long(1분 넘는 녹음) | failed. 값 목록은 앱이 정한다(실험 기능이라 CHECK 를 두지 않는다 — V49 와 같다).
-- transcribed_at 은 받아쓰기 모델을 부른 시각이다. 하루 호출 한도를 이 값으로 센다.
-- 녹음을 지우면 행도 지운다. 더하기만 하는 표라 옛 서버는 이 표를 모른다(PracticeRollbackCompatibilityTest).
CREATE TABLE public.reading_recording_retranscripts (
    recording_id uuid NOT NULL,
    object_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    peak_db double precision,
    transcript text,
    transcribed_at timestamp with time zone,
    failure text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_recording_retranscripts_pkey PRIMARY KEY (recording_id),
    CONSTRAINT reading_recording_retranscripts_recording_id_fkey
        FOREIGN KEY (recording_id) REFERENCES public.reading_recordings(id) ON DELETE CASCADE
);

CREATE INDEX idx_reading_recording_retranscripts_queue
    ON public.reading_recording_retranscripts (status, lease_until)
    WHERE status = ANY (ARRAY['queued'::text, 'running'::text]);

CREATE INDEX idx_reading_recording_retranscripts_transcribed
    ON public.reading_recording_retranscripts (transcribed_at)
    WHERE transcribed_at IS NOT NULL;
