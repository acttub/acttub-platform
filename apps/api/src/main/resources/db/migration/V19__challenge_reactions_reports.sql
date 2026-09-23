-- 저장·댓글·신고 (challenge.react, challenge.report). 기존 표는 바꾸지 않는다.

-- 다른 사람의 참여작을 다시 찾는 개인 북마크. 참여작이 지워지면 행도 지운다.
CREATE TABLE public.entry_saves (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.challenge_entries(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_entry_saves_actor UNIQUE (entry_id,user_id)
);
CREATE INDEX ix_entry_saves_user ON public.entry_saves(user_id,created_at DESC,id DESC);

-- 한 겹 댓글. 삭제는 본문을 파기하고 표시만 남긴다. 신고 숨김은 status hidden 이다.
CREATE TABLE public.entry_comments (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.challenge_entries(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    body text,
    status text DEFAULT 'visible' NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT uq_entry_comments_request UNIQUE (user_id,request_id),
    CONSTRAINT ck_entry_comments_status CHECK (status IN ('visible','hidden')),
    CONSTRAINT ck_entry_comments_body CHECK (char_length(body) BETWEEN 1 AND 500),
    CONSTRAINT ck_entry_comments_deleted CHECK ((deleted_at IS NULL) = (body IS NOT NULL))
);
CREATE INDEX ix_entry_comments_entry ON public.entry_comments(entry_id,created_at DESC,id DESC);
CREATE INDEX ix_entry_comments_user_created ON public.entry_comments(user_id,created_at);

-- 참여작·댓글·챌린지 신고. 같은 사람이 같은 대상에 한 번. 처리 완료 90일 뒤 지운다.
-- target_text 는 신고 당시의 캡션·댓글·대사다(운영이 수정 전후를 본다). 대상의 본문이 파기되면 함께 비운다.
CREATE TABLE public.entry_reports (
    id uuid PRIMARY KEY,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reporter_id uuid NOT NULL REFERENCES public.users(id),
    reason text NOT NULL,
    note text,
    status text DEFAULT 'received' NOT NULL,
    resolution text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    resolution_note text,
    target_version integer NOT NULL,
    target_text text,
    request_id uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_entry_reports_target UNIQUE (target_type,target_id,reporter_id),
    CONSTRAINT uq_entry_reports_request UNIQUE (reporter_id,request_id),
    CONSTRAINT ck_entry_reports_target_type CHECK (target_type IN ('entry','comment','challenge')),
    CONSTRAINT ck_entry_reports_reason CHECK (reason IN ('copyright','inappropriate','spam','duplicate','other')),
    CONSTRAINT ck_entry_reports_status CHECK (status IN ('received','reviewed')),
    CONSTRAINT ck_entry_reports_resolution CHECK (resolution IN ('restored','kept_hidden','dismissed')),
    CONSTRAINT ck_entry_reports_reviewed CHECK ((status='reviewed') = (resolution IS NOT NULL AND reviewed_at IS NOT NULL)),
    CONSTRAINT ck_entry_reports_note CHECK (char_length(note) <= 200),
    CONSTRAINT ck_entry_reports_version CHECK (target_version > 0)
);
CREATE INDEX ix_entry_reports_open ON public.entry_reports(target_type,target_id) WHERE status='received';
CREATE INDEX ix_entry_reports_queue ON public.entry_reports(status,created_at);
CREATE INDEX ix_entry_reports_reporter_created ON public.entry_reports(reporter_id,created_at);
