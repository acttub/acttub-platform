-- 연습 1.0.0 스키마 (SOMA-546, ADR-027). 근거는 docs/requirements/00-common.md 「ERD에 반영할 변경」의
-- 연습 행과 02-practice.md 의 각 기능이다.
--
-- ⚠️ 이 파일도 넓히기만 한다(V9 머리말과 같은 규칙). 테이블 열은 전부 새것이라 직전 운영 태그의 서버가
-- 모르는 것이고 되돌려도 그 서버가 그대로 뜬다. 기존 테이블에 손대는 것은 `upload_intents` 에 NULL 허용
-- 컬럼 셋(예약 장부로 계속 쓰기 위해)과 `users` 에 NULL 허용·기본값 있는 컬럼 둘을 더하는 것뿐이다.
--
-- 🔥 <b>옛 테이블은 건드리지 않는다.</b> practice_sessions·transcripts·summaries·anomalies·coach_sessions·
-- coach_turns·coaching_handoffs·practice_reports·actor_memory_entries·external_operations 는 그대로 남는다.
-- 데이터 전환은 Flyway 가 아니라 재실행 가능한 애플리케이션 명령이고(02-practice 「1.0.0 스키마 전환」),
-- 옛 테이블의 삭제는 읽기·쓰기를 모두 중단한 버전을 배포한 다음 릴리스부터다.
--
-- 값 목록은 text + CHECK 다(ADR-023, CONTRACT.md §5-3-1). 값 이름은 DB 값이자 API 값이다.
-- FK 에 ON DELETE 를 두지 않는다 — 영상·회차·탈퇴의 삭제는 애플리케이션이 표(02-practice 「연습 자료의
-- 이관·삭제·탈퇴」)대로 순서를 정해 지운다.


-- ① videos — 배우의 보관함에 있는 영상 한 편(practice.record, practice.library).
--
--    영상은 연습에서 독립한 자산이다. 코칭 회차와 챌린지 참여작이 같은 `id` 를 가리키고 객체는 하나다.
--    `purged_at` 은 "파일만 파기"와 탈퇴 파기 뒤의 표식이다 — 행과 최소 메타는 남아 회차·참여작의 기록이
--    깨지지 않고, 재생은 막히며 총량(`purged_at IS NULL` 인 행의 `byte_size` 합)에서 빠진다.
CREATE TABLE public.videos (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    object_key text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    duration_ms integer NOT NULL,
    width integer,
    height integer,
    favorite boolean DEFAULT false NOT NULL,
    purged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT videos_pkey PRIMARY KEY (id),
    CONSTRAINT videos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT ck_videos_byte_size CHECK ((byte_size >= 0)),
    CONSTRAINT ck_videos_duration_ms CHECK ((duration_ms >= 0))
);

-- 보관함은 최신 저장순이고 총량은 소유자로 센다.
CREATE INDEX idx_videos_user_created
    ON public.videos USING btree (user_id, created_at DESC);


-- ② video_transcripts — 영상 하나의 받아쓰기 묶음(practice.record, practice.analyze).
--
--    영상당 <b>묶음 하나</b>다(`video_id` 유일). 첫 분석이 만들고 같은 영상의 다음 회차가 재사용한다.
--    같은 영상의 첫 분석 둘이 동시에 시작해도 이 유일 제약이 생성 예약을 공유하게 한다 — 먼저 넣은 쪽이
--    `reserved` 행의 주인이고 진 쪽은 그 행을 기다렸다 쓴다. 순서 있는 조각(원문·단어 시각·간격·처리 구간)은
--    `segments` 안에 순서대로 둔다: 묶음은 통째로 쓰이고 조각 단위로 조회하지 않는다.
CREATE TABLE public.video_transcripts (
    id uuid NOT NULL,
    video_id uuid NOT NULL,
    status text NOT NULL,
    source text,
    segments jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT video_transcripts_pkey PRIMARY KEY (id),
    CONSTRAINT video_transcripts_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id),
    CONSTRAINT uq_video_transcripts_video UNIQUE (video_id),
    CONSTRAINT ck_video_transcripts_status
        CHECK ((status = ANY (ARRAY['reserved'::text, 'ready'::text, 'failed'::text])))
);


-- ③ practices — 연습 회차 하나(practice.start, practice.resume, practice.library).
--
--    묶음은 `root_id` 가 같은 회차들이고 `ordinal` 이 n차다. 첫 회차는 `root_id = id`·`ordinal = 1` 이며
--    묶음 속성(제목·태그·즐겨찾기·숨김)은 <b>첫 행</b>에만 둔다. `legacy_hidden_at` 은 옛 개별 세션 숨김을
--    옮겨 받는 자리다 — 승격해서 묶음을 숨기지 않는다.
--
--    `stage` 는 회차의 진행이고 `analyses.status` 와 다른 것이다. 묶음 안에 closed 아닌 회차는 하나뿐이다
--    (부분 유일 인덱스) — "다른 진행 중 회차가 있으면 409 practice_in_progress" 가 이 제약에서 나온다.
CREATE TABLE public.practices (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    root_id uuid NOT NULL,
    ordinal integer NOT NULL,
    stage text NOT NULL,
    close_reason text,
    experience_version text NOT NULL,
    request_id uuid,
    request_fingerprint character(64),
    situation text DEFAULT ''::text NOT NULL,
    character_context text DEFAULT ''::text NOT NULL,
    goal text DEFAULT ''::text NOT NULL,
    blockage_kind text NOT NULL,
    sub_branch text NOT NULL,
    blockage_detail text,
    title text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    favorite boolean DEFAULT false NOT NULL,
    hidden_at timestamp with time zone,
    legacy_hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT practices_pkey PRIMARY KEY (id),
    CONSTRAINT practices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT practices_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id),
    CONSTRAINT practices_root_id_fkey FOREIGN KEY (root_id) REFERENCES public.practices(id),
    CONSTRAINT uq_practices_root_ordinal UNIQUE (root_id, ordinal),
    CONSTRAINT uq_practices_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_practices_ordinal CHECK ((ordinal >= 1)),
    CONSTRAINT ck_practices_stage
        CHECK ((stage = ANY (ARRAY['analyzing'::text, 'conversing'::text, 'closed'::text]))),
    CONSTRAINT ck_practices_close_reason
        CHECK ((close_reason = ANY (ARRAY['analysis_failed'::text, 'cancelled'::text, 'conversation_closed'::text]))),
    CONSTRAINT ck_practices_experience_version
        CHECK ((experience_version = ANY (ARRAY['legacy'::text, 'three_layers_v1'::text]))),
    -- 옛 practice_sessions 와 같은 조합이다(V1 ck_practice_sessions_blockage_branch).
    CONSTRAINT ck_practices_blockage_branch
        CHECK ((((blockage_kind = '분석'::text) AND (sub_branch = ANY (ARRAY['캐릭터 분석'::text, '대사 분석'::text, '그 외'::text])))
             OR ((blockage_kind = '표현'::text) AND (sub_branch = ANY (ARRAY['감정'::text, '움직임'::text, '화술'::text, '표정'::text, '그 외'::text])))
             OR ((blockage_kind = '그 외'::text) AND (sub_branch = '그 외'::text))))
);

-- 묶음당 진행 중(closed 아님) 회차는 하나다.
CREATE UNIQUE INDEX uq_practices_open_root
    ON public.practices USING btree (root_id) WHERE (stage <> 'closed'::text);
-- 연습 기록은 묶음을 최근 순으로 읽고, 영상 삭제는 참조를 영상으로 찾는다.
CREATE INDEX idx_practices_user_created
    ON public.practices USING btree (user_id, created_at DESC);
CREATE INDEX idx_practices_video
    ON public.practices USING btree (video_id);
CREATE INDEX idx_practices_root
    ON public.practices USING btree (root_id, ordinal);


-- ④ analyses — 회차 하나의 관찰 기록(practice.analyze).
--
--    회차와 1:1 이고 완료 뒤 <b>불변</b>이다(워커 재시도가 기록을 덮거나 version 을 올리지 않는다).
--    신형(`video_record_v1`)은 `acttub.video_record.v1` 기록 전체가 `record` 이고 `id = record_id` 다.
--    기존 갈래(`legacy`)는 현행 ObservationPack 원문을 그대로 둔다 — 구형을 신형으로 위장하지 않는다.
CREATE TABLE public.analyses (
    id uuid NOT NULL,
    practice_id uuid NOT NULL,
    format text NOT NULL,
    status text NOT NULL,
    model text NOT NULL,
    record jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    CONSTRAINT analyses_pkey PRIMARY KEY (id),
    CONSTRAINT analyses_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id),
    CONSTRAINT uq_analyses_practice UNIQUE (practice_id),
    CONSTRAINT ck_analyses_format
        CHECK ((format = ANY (ARRAY['video_record_v1'::text, 'legacy'::text]))),
    CONSTRAINT ck_analyses_status
        CHECK ((status = ANY (ARRAY['ready'::text, 'partial'::text])))
);


-- ⑤ coach_conversations — 회차 하나의 코치 대화(practice.coach).
--
--    <b>회차에 대화는 하나다</b>(`practice_id` 유일). 열린 대화는 같은 id 로 재개하고, 닫힌 뒤 다시 코칭하려면
--    새 회차다. `start_request_id` 로 시작이 멱등하고, 동시 요청은 `state_revision` 으로 가른다(다르면 409).
--    `state` 에는 배우의 말·정정·영상 근거·코치 제안·실행 보고를 출처별로 나눠 둔다 — 프로필 스냅샷은 두지
--    않는다(§7-2).
CREATE TABLE public.coach_conversations (
    id uuid NOT NULL,
    practice_id uuid NOT NULL,
    start_request_id uuid NOT NULL,
    status text NOT NULL,
    close_reason text,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    state_revision integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT coach_conversations_pkey PRIMARY KEY (id),
    CONSTRAINT coach_conversations_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id),
    CONSTRAINT uq_coach_conversations_practice UNIQUE (practice_id),
    CONSTRAINT ck_coach_conversations_status
        CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    -- 신형의 `system_failure` 가 옛 coach_sessions 의 넷에 더해진다(practice.note).
    CONSTRAINT ck_coach_conversations_close_reason
        CHECK ((close_reason = ANY (ARRAY['gap_stated'::text, 'exhausted'::text, 'limit'::text, 'user_ended'::text, 'system_failure'::text]))),
    CONSTRAINT ck_coach_conversations_state_revision CHECK ((state_revision >= 0))
);


-- ⑥ coach_messages — 대화의 한 턴(practice.coach). 쌓이기만 한다.
--
--    `turn_index` 가 순서이고 배우 메시지는 `(conversation_id, request_id)` 로 멱등하다. 같은 요청 id 에 다른
--    본문이 오면 422 `request_fingerprint_mismatch` 라 지문을 함께 둔다. 코치 응답에는 요청 id 가 없다.
CREATE TABLE public.coach_messages (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    turn_index integer NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    request_id uuid,
    request_fingerprint character(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coach_messages_pkey PRIMARY KEY (id),
    CONSTRAINT coach_messages_conversation_id_fkey
        FOREIGN KEY (conversation_id) REFERENCES public.coach_conversations(id),
    CONSTRAINT uq_coach_messages_turn UNIQUE (conversation_id, turn_index),
    CONSTRAINT uq_coach_messages_request UNIQUE (conversation_id, request_id),
    CONSTRAINT ck_coach_messages_turn_index CHECK ((turn_index >= 0)),
    -- 옛 coach_turns 와 같은 값이다(V1 ck_coach_turns_role).
    CONSTRAINT ck_coach_messages_role
        CHECK ((role = ANY (ARRAY['ai'::text, 'actor'::text])))
);


-- ⑦ coach_notes — 대화 하나의 연습 노트(practice.note).
--
--    대화와 1:1 이고 <b>한 번만</b> 만든다(고정된 `source_revision` 으로). `practice_id` 를 두지 않고 대화를
--    거친다 — 방향·초점·출처는 대화 상태에서 읽는다. 기존 갈래(`legacy`)는 종류 analysis·expression 과 현행
--    응답 모양을 유지하고 원문을 `legacy_report` 에 둔다. 신형(`v2`)은 action·observation·record_only 이고
--    초점이 없는 record_only 의 제목은 NULL 이다.
CREATE TABLE public.coach_notes (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    format text NOT NULL,
    kind text NOT NULL,
    title text,
    summary_quotes jsonb DEFAULT '[]'::jsonb NOT NULL,
    next_take text,
    actor_words jsonb DEFAULT '[]'::jsonb NOT NULL,
    corrections jsonb DEFAULT '[]'::jsonb NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    fallback boolean DEFAULT false NOT NULL,
    source_revision integer NOT NULL,
    legacy_report jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coach_notes_pkey PRIMARY KEY (id),
    CONSTRAINT coach_notes_conversation_id_fkey
        FOREIGN KEY (conversation_id) REFERENCES public.coach_conversations(id),
    CONSTRAINT uq_coach_notes_conversation UNIQUE (conversation_id),
    CONSTRAINT ck_coach_notes_format
        CHECK ((format = ANY (ARRAY['legacy'::text, 'v2'::text]))),
    CONSTRAINT ck_coach_notes_kind
        CHECK ((kind = ANY (ARRAY['analysis'::text, 'expression'::text, 'action'::text, 'observation'::text, 'record_only'::text]))),
    CONSTRAINT ck_coach_notes_source_revision CHECK ((source_revision >= 0))
);


-- ⑧ actor_memories — 배우 기억 네 항목(practice.memory).
--
--    `(user_id, field)` 유일이고 성별·나이는 여기 없다 — 프로필로 옮겼다(account.profile). 배우가 쓴 값은
--    에이전트가 덮지 않는다(규칙은 app 계층).
CREATE TABLE public.actor_memories (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    field text NOT NULL,
    value text NOT NULL,
    written_by text NOT NULL,
    source_practice_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT actor_memories_pkey PRIMARY KEY (id),
    CONSTRAINT actor_memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT actor_memories_source_practice_id_fkey
        FOREIGN KEY (source_practice_id) REFERENCES public.practices(id),
    CONSTRAINT uq_actor_memories_user_field UNIQUE (user_id, field),
    CONSTRAINT ck_actor_memories_field
        CHECK ((field = ANY (ARRAY['goal'::text, 'blockage'::text, 'speech_self'::text, 'speech_actual'::text]))),
    CONSTRAINT ck_actor_memories_written_by
        CHECK ((written_by = ANY (ARRAY['actor'::text, 'agent'::text]))),
    CONSTRAINT ck_actor_memories_value_length CHECK ((char_length(value) <= 1000)),
    CONSTRAINT ck_actor_memories_value_not_blank CHECK ((btrim(value) <> ''::text))
);


-- ⑨ practice_feedback — 이탈 설문 한 건(practice.feedback).
--
--    `body` 가 NULL 이면 건너뛰기(dismissed)다. 연락처는 접수 90일 뒤와 탈퇴 때 비우고, 같은 설문 id·더 큰
--    `sheet_seq` 로 시트에 다시 보내 시트의 연락처도 지운다 — 순번이 작은 전송은 무시된다.
CREATE TABLE public.practice_feedback (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    practice_id uuid,
    screen text NOT NULL,
    trigger text NOT NULL,
    body text,
    contact_email text,
    contact_phone text,
    sheet_synced_at timestamp with time zone,
    sheet_seq integer DEFAULT 1 NOT NULL,
    request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT practice_feedback_pkey PRIMARY KEY (id),
    CONSTRAINT practice_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT practice_feedback_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id),
    CONSTRAINT uq_practice_feedback_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_practice_feedback_screen
        CHECK ((screen = ANY (ARRAY['coach'::text, 'report'::text]))),
    CONSTRAINT ck_practice_feedback_trigger
        CHECK ((trigger = ANY (ARRAY['x'::text, 'leave'::text, 'back'::text]))),
    CONSTRAINT ck_practice_feedback_sheet_seq CHECK ((sheet_seq >= 1))
);

-- 매일 도는 일이 못 보낸 것과 90일 지난 연락처를 찾는다.
CREATE INDEX idx_practice_feedback_sheet_pending
    ON public.practice_feedback USING btree (created_at) WHERE (sheet_synced_at IS NULL);


-- ⑩ ai_jobs — 비동기 AI 요청의 장부(practice.analyze, practice.memory).
--
--    종류는 <b>analyze·memory_update 둘</b>이다 — 리딩·설문·정리 장부는 여기 넣지 않는다. lease 규칙은
--    `external_operations` 와 같다(CONTRACT §5-7): 만료 뒤에도 다른 워커가 선점하기 전이면 완료를 받고,
--    토큰이 바뀌었으면 거절한다. `failure_reason` 에 CHECK 를 두지 않는다 — 분류가 열린 목록이고
--    (timeout·parse·unsupported·cancelled·account_deactivated 등) 옛 `external_operations.error_code` 와 같다.
--    `memory_epoch` 은 memory_update 가 예약한 시점의 기억 세대다(다르면 결과를 반영하지 않는다).
CREATE TABLE public.ai_jobs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    target_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint character(64) NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    failure_reason text,
    result jsonb,
    memory_epoch integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT ai_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT uq_ai_jobs_user_request UNIQUE (user_id, request_id),
    CONSTRAINT ck_ai_jobs_kind
        CHECK ((kind = ANY (ARRAY['analyze'::text, 'memory_update'::text]))),
    CONSTRAINT ck_ai_jobs_status
        CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT ck_ai_jobs_attempt_count CHECK ((attempt_count >= 0))
);

-- 워커는 때가 된 작업을 오래된 순으로 집고, 화면은 대상으로 상태를 읽는다.
CREATE INDEX idx_ai_jobs_due
    ON public.ai_jobs USING btree (status, created_at);
CREATE INDEX idx_ai_jobs_target
    ON public.ai_jobs USING btree (target_id, created_at DESC);


-- ⑪ upload_intents — 예약 장부로 계속 쓴다(practice.record).
--
--    새 쓰기가 이어지는 유일한 옛 테이블이다. 마무리가 만든 영상을 `video_id` 로 가리켜 "마무리 재전송은 같은
--    영상"을 이 장부 하나로 답한다. `request_id` 는 기기가 만든 요청 id 이고 지문이 본문을 묶는다 — 옛 행에는
--    없으므로 NULL 허용이며, 부분 유일 인덱스라 옛 행들이 서로 부딪히지 않는다.
ALTER TABLE public.upload_intents
    ADD COLUMN request_id uuid,
    ADD COLUMN request_fingerprint character(64),
    ADD COLUMN video_id uuid,
    ADD CONSTRAINT upload_intents_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id);

CREATE UNIQUE INDEX uq_upload_intents_user_request
    ON public.upload_intents USING btree (user_id, request_id) WHERE (request_id IS NOT NULL);


-- ⑫ users — 이탈 설문의 노출 선점과 기억 세대(practice.feedback, practice.memory).
--
--    `exit_survey_asked_at` 은 계정에 한 번만 묻기 위한 <b>원자적 선점</b> 자리다(두 기기가 동시에 자동 노출
--    조건이어도 UPDATE … WHERE exit_survey_asked_at IS NULL 이 하나만 이긴다). `memory_epoch` 은 기억을 지우거나
--    이관에서 한쪽을 고를 때 올라가고, 그때 돌고 있던 갱신 작업의 결과는 반영되지 않는다.
ALTER TABLE public.users
    ADD COLUMN exit_survey_asked_at timestamp with time zone,
    ADD COLUMN memory_epoch integer DEFAULT 0 NOT NULL;
