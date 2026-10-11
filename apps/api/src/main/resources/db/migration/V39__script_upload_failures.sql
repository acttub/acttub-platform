-- 읽거나 나누지 못한 대본 원본을 1년 보관해 읽기·나누기를 고치는 데 쓴다 (reading.script 「원본 파일」, script_split v2 5항).
--
-- failure — 못 한 이유. 읽기 실패는 글자 뽑기의 사유(no_text·hwp3·timeout·broken: …), 나누기 실패는 script_imports.failure 값
-- (failed·not_script·no_characters)이다. 재배포로 서버 로그가 사라져도 원인이 행에 남는다.
-- kept_until — 그 사용자의 script_split 현재 판 결정이 granted 일 때만 찬다. 비어 있으면 지금처럼 하루 뒤 지운다.
-- 동의를 거두면(판과 상관없이 가장 최근 script_split 결정이 granted 가 아니면) 다음 정리가 보관 중인 행도 지운다.
-- NULL 허용 칸만 더하므로 옛 서버는 그대로 돈다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.script_uploads ADD COLUMN failure text;
ALTER TABLE public.script_uploads ADD COLUMN kept_until timestamp with time zone;
ALTER TABLE public.script_uploads ADD CONSTRAINT ck_script_uploads_kept_failure
    CHECK ((kept_until IS NULL OR failure IS NOT NULL));
