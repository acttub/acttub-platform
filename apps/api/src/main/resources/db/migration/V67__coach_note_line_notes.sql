-- 코칭 노트의 「대사별로 본 것」(SOMA-900, Pro). 대화가 닫히고 노트가 저장된 뒤 따로 채운다.
-- [{ "line": 대사·순간, "seen": 코치가 본 것, "try": 다음 테이크에 해 볼 것 }] — 없으면 빈 배열이다.
-- 추가 칸이고 기본값이 있어 이 칸을 모르는 옛 서버·읽기 코드가 그대로 동작한다.
ALTER TABLE public.coach_notes
    ADD COLUMN line_notes jsonb DEFAULT '[]'::jsonb NOT NULL;
