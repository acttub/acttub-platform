-- 인스타 공유·영상 저장에 씌우는 프레임 영상과 미리보기 그림의 객체 키 (SOMA-1156). 서버가 참여작 영상에 프레임을 입혀
-- 원본 옆(videos/{사용자}/{요청}.frame-{참여작}-…)에 올리고 여기에 적는다. 적힌 키는 다시 만들지 않고 바로 내준다.
--
-- 모자이크본(mosaic_key)과 같이 참여작 삭제·얼굴 모자이크 상태 변경·영상 파일 파기·탈퇴 때 이 목록을 정리 장부에 올리고
-- 비운다. 더하기만 하는 변경이다 — 직전 판 API 는 이 열을 모르고 넣으므로 기본값(빈 목록)이 그 상태다.
ALTER TABLE public.challenge_entries
    ADD COLUMN share_frame_keys text[] DEFAULT '{}'::text[] NOT NULL;
