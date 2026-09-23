-- 대본 리딩 1.0.0 스키마 (SOMA-546, ADR-031). 근거는 docs/requirements/00-common.md 「ERD에 반영할 변경」의
-- 리딩 행과 03-reading.md 의 각 기능이다.
--
-- ⚠️ 이 파일도 넓히기만 한다(V9 머리말과 같은 규칙). 테이블 여섯은 전부 새것이라 직전 운영 태그의 서버가
-- 모르는 것이고 되돌려도 그 서버가 그대로 뜬다. 기존 테이블에 손대는 것은 정리 장부의 값 목록에 종류
-- 하나를 더하는 것뿐이다.
--
-- 값 목록은 text + CHECK 다(ADR-023, CONTRACT.md §5-3-1). 값 이름은 DB 값이자 API 값이다.
-- FK 에 ON DELETE 를 두지 않는다 — 대본·회차·탈퇴의 삭제는 애플리케이션이 표(03-reading 「리딩 자료의
-- 이관·삭제·탈퇴」)대로 순서를 정해 지우고, 보관 동의자의 녹음은 부모를 지우기 전에 연결을 비운다.
-- 리딩 테이블은 users 와 scripts 에만 매달린다(ERD 결정). 영상 연습 테이블과 잇지 않는다.


-- ① scripts — 배우가 등록한 대본 한 편(reading.script).
--
--    원문(`raw_text`)은 뒤에 파서가 나아졌을 때 다시 나누기 위해 둔다(1.0.0 에는 다시 나누기가 없다).
--    `request_id` 는 기기가 만든 요청 id 로 (user_id, request_id) 가 유일하다 — 연결이 끊겨 같은 요청을
--    다시 보내도 대본이 둘이 되지 않는다. 이관으로 게스트와 회원의 request_id 가 겹치면(UUID 라 실질적으로
--    없다) 게스트 쪽 값을 비우므로 NULL 허용이다. `request_fingerprint` 는 생성 요청의 정규화한 본문 지문이고
--    뒤에 제목·배역 이름을 고쳐도 바꾸지 않는다 — 재전송 판정은 이 지문으로 한다.
--    줄 수·대사 수·녹음 수 컬럼은 두지 않는다(집계). 삭제 시각도 없다(행째 삭제).
CREATE TABLE public.scripts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    raw_text text NOT NULL,
    source text NOT NULL,
    request_id uuid,
    request_fingerprint character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scripts_pkey PRIMARY KEY (id),
    CONSTRAINT scripts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT uq_scripts_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_scripts_source
        CHECK ((source = ANY (ARRAY['file'::text, 'paste'::text, 'typed'::text, 'sample'::text])))
);

-- 목록은 최근 고친 순이다.
CREATE INDEX idx_scripts_user_updated
    ON public.scripts USING btree (user_id, updated_at DESC);


-- ② script_characters — 대본 안에서 대사를 말하는 인물(reading.script · reading.cast).
--
--    이름은 앞뒤 공백을 정리한 뒤 비어 있지 않고 같은 대본 안에서 유일하다. 유일 제약은 DEFERRABLE 이다 —
--    이름 수정이 두 배역의 이름을 맞바꿀 때 문장 하나 안에서도 잠시 겹치기 때문이다(앱은 트랜잭션 안에서
--    `SET CONSTRAINTS ... DEFERRED` 로 미룬다).
--    `voice_preset` 은 상대역 목소리(기기 프리셋 id, 32자 이내)이고 NULL 이면 "자동"이다. 서버는 목록을
--    모른다. "대사 수" 컬럼은 두지 않는다(집계).
CREATE TABLE public.script_characters (
    id uuid NOT NULL,
    script_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    voice_preset text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT script_characters_pkey PRIMARY KEY (id),
    CONSTRAINT script_characters_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id),
    CONSTRAINT uq_script_characters_script_name UNIQUE (script_id, name) DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT uq_script_characters_script_order UNIQUE (script_id, sort_order),
    CONSTRAINT ck_script_characters_name_trimmed CHECK ((name = btrim(name)) AND (name <> ''::text)),
    CONSTRAINT ck_script_characters_voice_preset_length CHECK ((char_length(voice_preset) <= 32))
);


-- ③ script_lines — 대본을 순서대로 나눈 줄(reading.script).
--
--    종류는 대사(배역 하나에 매달림)·지문·장면(막·장 머리) 셋이다. 대사만 `character_id` 를 갖고 지문·장면은
--    NULL 이다 — CHECK 가 둘을 묶는다. 저장 뒤 줄 구조는 고정이라 갱신 시각이 없다. "대사 번호"는 저장하지
--    않고 순서(`ordinal`)에서 센다.
CREATE TABLE public.script_lines (
    id uuid NOT NULL,
    script_id uuid NOT NULL,
    ordinal integer NOT NULL,
    kind text NOT NULL,
    character_id uuid,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT script_lines_pkey PRIMARY KEY (id),
    CONSTRAINT script_lines_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id),
    CONSTRAINT script_lines_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.script_characters(id),
    CONSTRAINT uq_script_lines_script_ordinal UNIQUE (script_id, ordinal),
    CONSTRAINT ck_script_lines_kind
        CHECK ((kind = ANY (ARRAY['dialogue'::text, 'direction'::text, 'scene'::text]))),
    CONSTRAINT ck_script_lines_dialogue_has_character
        CHECK (((kind = 'dialogue'::text) = (character_id IS NOT NULL)))
);

-- 배역의 대사 수 집계.
CREATE INDEX idx_script_lines_character
    ON public.script_lines USING btree (character_id);


-- ④ reading_sessions — 리딩 회차(reading.cast · reading.session).
--
--    속성(내 배역·방식·구간·넘김·녹음)은 시작할 때 정하고 뒤에 바꾸지 않는다. 진행 위치 `current_line_id` 는
--    다음에 할 대사 줄이고 completed 면 NULL 이다. `progress_seq` 는 기기가 1씩 늘리는 순번으로, 서버는 저장된
--    값보다 큰 요청만 반영한다. `line_results` 는 줄마다 하나인 {line_id, outcome, misses} 배열이다.
--    열린 회차는 대본당 하나다(부분 유일 인덱스). (user_id, request_id) 유일 — 재전송이 회차를 둘 만들지
--    않는다. "목소리"·"읽은 줄 수" 컬럼은 두지 않는다.
CREATE TABLE public.reading_sessions (
    id uuid NOT NULL,
    script_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid,
    my_character_ids uuid[] NOT NULL,
    mode text NOT NULL,
    start_line_id uuid NOT NULL,
    end_line_id uuid NOT NULL,
    advance text NOT NULL,
    record boolean NOT NULL,
    status text NOT NULL,
    current_line_id uuid,
    elapsed_seconds integer DEFAULT 0 NOT NULL,
    progress_seq bigint DEFAULT 0 NOT NULL,
    line_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT reading_sessions_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id),
    CONSTRAINT reading_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT reading_sessions_start_line_id_fkey FOREIGN KEY (start_line_id) REFERENCES public.script_lines(id),
    CONSTRAINT reading_sessions_end_line_id_fkey FOREIGN KEY (end_line_id) REFERENCES public.script_lines(id),
    CONSTRAINT reading_sessions_current_line_id_fkey FOREIGN KEY (current_line_id) REFERENCES public.script_lines(id),
    CONSTRAINT uq_reading_sessions_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_reading_sessions_mode
        CHECK ((mode = ANY (ARRAY['read'::text, 'quiz'::text]))),
    CONSTRAINT ck_reading_sessions_advance
        CHECK ((advance = ANY (ARRAY['silence'::text, 'manual'::text]))),
    CONSTRAINT ck_reading_sessions_status
        CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'stopped'::text]))),
    CONSTRAINT ck_reading_sessions_my_characters_not_empty
        CHECK ((cardinality(my_character_ids) >= 1))
);

CREATE UNIQUE INDEX uq_reading_sessions_open_script
    ON public.reading_sessions USING btree (script_id)
    WHERE (status = 'in_progress'::text);

-- 회차 목록과 대본 카드의 "마지막 회차"는 시작 시각 순이다.
CREATE INDEX idx_reading_sessions_script_started
    ON public.reading_sessions USING btree (script_id, started_at DESC);
CREATE INDEX idx_reading_sessions_user
    ON public.reading_sessions USING btree (user_id);


-- ⑤ reading_recordings — 내 대사 줄 하나 = 파일 하나(reading.recording).
--
--    `user_id` 는 현재 소유자다(이관 때 회차와 함께 바뀌고 탈퇴 보관 때 유지). 탈퇴 보관을 위해 회차·줄 연결은
--    NULL 허용이고, 보관 행은 일반 API 에 보이지 않는다. (reading_session_id, line_id) 유일 — 같은 줄을 다시
--    말하면 새 녹음이 이전 것을 대체한다. `attempt_no` 가 대체 순서를 가르고, 객체 키는 요청마다 달라 재사용하지
--    않는다. `byte_size` 는 변환 뒤 크기다. `transcript_source` 가 none 이면 전사·대조는 NULL 이다.
CREATE TABLE public.reading_recordings (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    reading_session_id uuid,
    line_id uuid,
    request_id uuid NOT NULL,
    attempt_no integer NOT NULL,
    object_key text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    duration_ms integer NOT NULL,
    transcript text,
    transcript_source text NOT NULL,
    matched boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_recordings_pkey PRIMARY KEY (id),
    CONSTRAINT reading_recordings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT reading_recordings_reading_session_id_fkey
        FOREIGN KEY (reading_session_id) REFERENCES public.reading_sessions(id),
    CONSTRAINT reading_recordings_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.script_lines(id),
    CONSTRAINT uq_reading_recordings_session_line UNIQUE (reading_session_id, line_id),
    CONSTRAINT uq_reading_recordings_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_reading_recordings_transcript_source
        CHECK ((transcript_source = ANY (ARRAY['stt'::text, 'none'::text]))),
    CONSTRAINT ck_reading_recordings_attempt_no CHECK ((attempt_no >= 1))
);

-- 계정당 총량(byte_size 합)과 탈퇴 파기가 소유자로 찾는다.
CREATE INDEX idx_reading_recordings_user
    ON public.reading_recordings USING btree (user_id);


-- ⑥ line_memorization — (사람, 줄)마다 하나인 암기 표시(reading.memorization).
--
--    행이 없으면 아직 표시하지 않은 줄이다. 회차를 지워도 남고 대본을 지우면 지운다. 시도 횟수 컬럼은 두지 않는다.
CREATE TABLE public.line_memorization (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    line_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT line_memorization_pkey PRIMARY KEY (id),
    CONSTRAINT line_memorization_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT line_memorization_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.script_lines(id),
    CONSTRAINT uq_line_memorization_user_line UNIQUE (user_id, line_id),
    CONSTRAINT ck_line_memorization_status
        CHECK ((status = ANY (ARRAY['memorized'::text, 'not_yet'::text])))
);

-- 대본 단위 조회와 대본 삭제가 줄로 찾는다.
CREATE INDEX idx_line_memorization_line
    ON public.line_memorization USING btree (line_id);


-- ⑦ account_cleanup_operations.kind — 리딩 녹음 객체 삭제(reading.recording · account.withdraw).
--
--    대본·회차 삭제, 같은 줄의 다시 말하기(대체), 탈퇴 파기, 변환 결과를 반영하지 못한 객체가 여기로 온다.
--    값을 더하기만 한다. 객체 삭제 작업이 성공할 때까지 대상 키를 유지하는 규칙(7일 연속 실패면 운영자 알림)은
--    장부의 실행기가 맡는다.
ALTER TABLE public.account_cleanup_operations
    DROP CONSTRAINT ck_account_cleanup_operations_kind;
ALTER TABLE public.account_cleanup_operations
    ADD CONSTRAINT ck_account_cleanup_operations_kind
        CHECK ((kind = ANY (ARRAY['object_delete'::text, 'apple_revoke'::text, 'kakao_unlink'::text,
                                  'naver_revoke'::text, 'reading_recording_delete'::text])));
