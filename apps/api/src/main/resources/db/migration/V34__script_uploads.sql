-- 대본 원본 파일을 서버가 받아 글자를 뽑고 대본과 같은 수명으로 보관한다 (reading.script 「원본 파일」).
--
-- script_uploads — 올린 파일 하나. 기기가 서명한 주소로 S3 에 직접 올리고, 서버가 읽어 raw_text 를 채운다. 그 글로 나누기가
-- 대본을 저장하면 script_id 가 차고, 그때부터 대본 삭제·탈퇴가 행과 객체를 함께 지운다. 하루가 지나도 script_id 가 비어 있으면
-- 매시간 도는 정리가 지운다. script_id 에 FK 를 두지 않는다 — script_imports 와 같이 대본 삭제가 순서를 정해 지운다.
CREATE TABLE public.script_uploads (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    object_key text NOT NULL,
    byte_size bigint NOT NULL,
    raw_text text,
    script_id uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT script_uploads_pkey PRIMARY KEY (id),
    CONSTRAINT script_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT uq_script_uploads_object_key UNIQUE (object_key),
    CONSTRAINT ck_script_uploads_byte_size CHECK ((byte_size > 0))
);

CREATE INDEX idx_script_uploads_user ON public.script_uploads USING btree (user_id);
CREATE INDEX idx_script_uploads_script ON public.script_uploads USING btree (script_id);
CREATE INDEX idx_script_uploads_unlinked ON public.script_uploads USING btree (created_at) WHERE (script_id IS NULL);

-- 원본 파일로 넣은 나누기 요청. 대본이 저장될 때 이 칸으로 원본을 찾아 연결한다.
ALTER TABLE public.script_imports ADD COLUMN upload_id uuid;
