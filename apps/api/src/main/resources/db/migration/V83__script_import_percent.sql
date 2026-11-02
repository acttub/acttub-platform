-- 나누기 작업의 화면 진행률(%) (reading.script 「나누기 작업」, SOMA-960).
-- done_lines/total_lines 는 줄을 나누는 동안만 움직여서, 그 뒤 단계(빠진 줄·줄 검토·마무리) 동안 화면이 100% 에 멈춰 있었다.
-- 더하기만 하는 변경이다 — 직전 판 API 는 이 칸을 모르고 기본값 0 으로 둔다.
ALTER TABLE public.script_imports ADD COLUMN progress_percent integer DEFAULT 0 NOT NULL;
ALTER TABLE public.script_imports ADD CONSTRAINT ck_script_imports_progress_percent
    CHECK ((progress_percent >= 0) AND (progress_percent <= 100));
