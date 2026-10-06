-- 서버가 대본 글을 받아 LLM 으로 배역·대사를 나눈다 (reading.script 「나누기 작업」).
--
-- ① ai_jobs 의 종류에 script_split 을 더한다. LLM 을 부르는 나누기 작업만 이 장부에 들어가고, 하루 한도(한 사람 20개)는
--    이 장부의 오늘 행 수로 센다 — 예시 대본·중복처럼 LLM 없이 끝나는 요청은 행을 만들지 않아 저절로 세지 않는다.
ALTER TABLE public.ai_jobs DROP CONSTRAINT ck_ai_jobs_kind;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ck_ai_jobs_kind
    CHECK ((kind = ANY (ARRAY['analyze'::text, 'memory_update'::text, 'challenge_report'::text, 'script_split'::text])));

-- ② 동의 문서의 종류에 script_split(대본 글을 OpenAI 로 보내는 처리, 선택)을 더한다. 문서는 법무 뒤 배포 파일로
--    발행한다 — 문서가 없는 동안은 아무도 동의할 수 없어 서버가 403 으로 막는다(환경 플래그 없음).
ALTER TABLE public.consent_documents DROP CONSTRAINT ck_consent_documents_type;
ALTER TABLE public.consent_documents ADD CONSTRAINT ck_consent_documents_type
    CHECK ((type = ANY (ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text,
                              'cloud_voice'::text, 'script_split'::text])));

-- ③ 같은 사람의 같은 글을 LLM 전에 알아보는 해시 (reading.script 「같은 글」).
--    NFC 정리 → U+200B·U+FEFF 제거 → 공백류 연속을 공백 하나로 → 앞뒤 공백 제거 → SHA-256. 새 행은 Java
--    (reading/domain/ScriptText)가 같은 식으로 채우고, 여기서는 기존 행만 한 번 채운다. 두 식이 같은지는
--    ReadingSchemaMigrationTest 가 실제 Postgres 로 대조한다. 공백류를 \s 가 아니라 목록으로 적은 것은 Postgres 의
--    \s 가 로케일(iswspace)을 따르기 때문이다.
ALTER TABLE public.scripts ADD COLUMN raw_hash character(64);
UPDATE public.scripts SET raw_hash = encode(sha256(convert_to(
    btrim(regexp_replace(regexp_replace(normalize(raw_text, NFC), '[\u200B\uFEFF]', '', 'g'),
                         '[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+', ' ', 'g'), ' '),
    'UTF8')), 'hex');
ALTER TABLE public.scripts ALTER COLUMN raw_hash SET NOT NULL;
CREATE INDEX idx_scripts_user_raw_hash ON public.scripts USING btree (user_id, raw_hash);

-- ④ script_imports — 나누기 요청 하나. 원문을 들고 있다가 워커가 나눠 대본으로 저장한다.
--    job_id 가 NULL 이면 LLM 없이 끝난 요청(예시 대본)이다. 상태는 칸이 아니라 조합이다: script_id 가 있으면 성공,
--    failure 가 있으면 실패, 둘 다 없으면 ai_jobs 의 상태(pending·running)를 따른다.
--    done_lines·total_lines 는 화면의 「N / M줄」이고 조각이 끝날 때마다 워커가 올린다.
--    script_id 에 FK 를 두지 않는다 — 대본 삭제가 이 표를 몰라도 되게.
CREATE TABLE public.script_imports (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint character(64) NOT NULL,
    title text,
    source text NOT NULL,
    raw_text text NOT NULL,
    raw_hash character(64) NOT NULL,
    job_id uuid,
    script_id uuid,
    failure text,
    done_lines integer DEFAULT 0 NOT NULL,
    total_lines integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT script_imports_pkey PRIMARY KEY (id),
    CONSTRAINT script_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT script_imports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_jobs(id),
    CONSTRAINT uq_script_imports_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_script_imports_source
        CHECK ((source = ANY (ARRAY['file'::text, 'paste'::text, 'typed'::text, 'sample'::text]))),
    CONSTRAINT ck_script_imports_failure
        CHECK ((failure = ANY (ARRAY['not_script'::text, 'no_characters'::text, 'script_too_long'::text,
                                     'script_limit'::text, 'failed'::text]))),
    CONSTRAINT ck_script_imports_outcome CHECK ((script_id IS NULL OR failure IS NULL)),
    CONSTRAINT ck_script_imports_progress CHECK ((done_lines >= 0 AND total_lines >= 0 AND done_lines <= total_lines))
);

-- 같은 글로 진행 중인 요청을 찾는다(두 번 누름).
CREATE INDEX idx_script_imports_user_raw_hash ON public.script_imports USING btree (user_id, raw_hash);
