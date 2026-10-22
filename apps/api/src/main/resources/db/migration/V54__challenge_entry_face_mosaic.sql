-- 챌린지 공개 참여작의 얼굴 모자이크(challenge.entry). 원본 영상은 그대로 두고, 켠 참여작은 서버가 만든 모자이크본만
-- 다른 사람에게 준다. 모자이크본이 준비되기 전이나 만들지 못하면 다른 사람에게 보이지 않는다.
-- face_mosaic 를 켜지 않은 행은 mosaic_status 가 비어 있다. 직전 판 API 는 이 열을 모르고 넣으므로 기본값이 그 상태다.
ALTER TABLE public.challenge_entries
    ADD COLUMN face_mosaic boolean DEFAULT false NOT NULL,
    ADD COLUMN mosaic_status text,
    ADD COLUMN mosaic_key text,
    ADD COLUMN mosaic_attempts integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT ck_challenge_entries_mosaic_status
        CHECK (mosaic_status IN ('pending', 'ready', 'failed')),
    ADD CONSTRAINT ck_challenge_entries_mosaic_requested
        CHECK (face_mosaic = (mosaic_status IS NOT NULL)),
    ADD CONSTRAINT ck_challenge_entries_mosaic_ready
        CHECK (mosaic_status <> 'ready' OR mosaic_key IS NOT NULL),
    ADD CONSTRAINT ck_challenge_entries_mosaic_attempts
        CHECK (mosaic_attempts >= 0);

-- 모자이크 워커가 만들 차례를 오래된 순으로 집는다.
CREATE INDEX ix_challenge_entries_mosaic_pending ON public.challenge_entries (created_at, id)
    WHERE mosaic_status = 'pending';
