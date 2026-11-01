-- 리딩 회차에 「전체 듣기」와 「핸즈프리」를 연다 (reading.session, 앱 1.1.1).
--
-- 1) 전체 듣기: 내 배역을 고르지 않고 시작하면 앱이 모든 대사를 읽어 준다. 이런 회차는 my_character_ids 가 빈 배열이다.
-- 2) 핸즈프리(advance 'timed'): 내 차례에 말하지 않아도 대사 길이만큼 쉬고 다음 줄로 넘어간다. 마이크를 열지 않는다.
--
-- 되돌리기: 이 판보다 앞선 서버는 advance 'timed' 회차를 읽을 때 ReadingAdvance 에 값이 없어 500 이다.
-- 이미지를 되돌리지 않고 고쳐서 다시 배포한다.
ALTER TABLE public.reading_sessions DROP CONSTRAINT ck_reading_sessions_my_characters_not_empty;

ALTER TABLE public.reading_sessions DROP CONSTRAINT ck_reading_sessions_advance;
ALTER TABLE public.reading_sessions ADD CONSTRAINT ck_reading_sessions_advance
    CHECK ((advance = ANY (ARRAY['silence'::text, 'manual'::text, 'timed'::text])));
