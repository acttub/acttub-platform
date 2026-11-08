-- 얼굴이 보이는 참여작을 진행 중 좋아요순 앞에 둔다 (SOMA-1066). 공개 참여작 AI 검사가 판정과 함께 얼굴이 보이는지도
-- 받아 둔다.
--
-- face_visible: NULL(모름 — 이 기능 전에 검사했거나 모델이 답하지 않았다), true(얼굴이 보인다), false(보이지 않는다).
-- face_attempts: 이미 검사가 끝난 참여작의 얼굴 여부만 다시 묻는 채우기(CHALLENGE_FACE_BACKFILL)의 시도 수. 상한에 닿으면 더
-- 묻지 않는다. 더하기만 하는 변경이다 — 직전 판 API 는 두 열을 모르고 넣으므로 기본값(NULL·0)이 그 상태다.
ALTER TABLE public.challenge_entries
    ADD COLUMN face_visible boolean,
    ADD COLUMN face_attempts integer DEFAULT 0 NOT NULL;
