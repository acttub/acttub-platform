-- 제목이 없는 대본에만 원본 파일명을 기본 제목으로 쓴다. 옛 업로드는 NULL을 유지한다.
ALTER TABLE public.script_uploads ADD COLUMN file_name text;
