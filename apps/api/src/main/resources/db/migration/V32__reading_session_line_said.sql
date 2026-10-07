-- 회차의 줄마다 말한 것(기기 음성 인식의 전사)을 둔다 (reading.session).
--
-- 진행 저장이 줄마다 말한 것을 보내면 서버가 원문과 비교해 line_results 의 결과를 정하고, 완료 화면·회차 상세의
-- 「원문과 다르게 말한 대사」가 이 글로 다른 어절을 칠한다. {line_id: 말한 것} 이고 결과가 없는 줄은 없다.
--
-- line_results 원소에 더하지 않고 칸을 따로 둔다: 이 판 앞의 서버는 line_results 를 모르는 키에서 실패하는 읽기로
-- 읽으므로, 같은 원소에 넣으면 이미지를 되돌렸을 때 그 회차의 상세·진행 저장이 500 이다. 따로 둔 칸은 옛 서버가
-- 읽지 않는다.
ALTER TABLE public.reading_sessions ADD COLUMN line_said jsonb DEFAULT '{}'::jsonb NOT NULL;
