-- 공개 집계와 개인 노출 조건의 기반. 기존 영상 자산을 참조하며 영상은 복제하지 않는다.
CREATE TABLE public.challenge_entries (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL REFERENCES public.challenges(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    video_id uuid REFERENCES public.videos(id),
    caption text,
    content_version integer DEFAULT 1 NOT NULL,
    published_at timestamp with time zone,
    visibility text NOT NULL,
    status text DEFAULT 'visible' NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    final_like_count bigint,
    final_eligible boolean,
    final_rank integer,
    request_id uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT uq_challenge_entries_request UNIQUE (user_id,request_id),
    CONSTRAINT uq_challenge_entries_parent UNIQUE (id,challenge_id),
    CONSTRAINT ck_challenge_entries_visibility CHECK (visibility IN ('public','private')),
    CONSTRAINT ck_challenge_entries_status CHECK (status IN ('visible','hidden_by_report','deleted')),
    CONSTRAINT ck_challenge_entries_caption CHECK (char_length(caption)<=300),
    CONSTRAINT ck_challenge_entries_version CHECK (content_version>0),
    CONSTRAINT ck_challenge_entries_views CHECK (view_count>=0),
    CONSTRAINT ck_challenge_entries_final_likes CHECK (final_like_count>=0),
    CONSTRAINT ck_challenge_entries_final_rank CHECK (final_rank>0),
    CONSTRAINT ck_challenge_entries_published CHECK (visibility<>'public' OR published_at IS NOT NULL),
    CONSTRAINT ck_challenge_entries_deleted CHECK ((status='deleted')=(deleted_at IS NOT NULL)),
    CONSTRAINT ck_challenge_entries_video CHECK ((status='deleted')=(video_id IS NULL)),
    CONSTRAINT ck_challenge_entries_purged_caption CHECK (status<>'deleted' OR caption IS NULL)
);
CREATE UNIQUE INDEX uq_challenge_entries_video ON public.challenge_entries(challenge_id,video_id) WHERE status<>'deleted';
CREATE INDEX ix_challenge_entries_public ON public.challenge_entries(challenge_id,published_at DESC,id DESC)
    WHERE visibility='public' AND status='visible';
CREATE INDEX ix_challenge_entries_owner ON public.challenge_entries(user_id,created_at);

CREATE TABLE public.entry_likes (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.challenge_entries(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_entry_likes_actor UNIQUE(entry_id,user_id)
);

CREATE TABLE public.user_blocks (
    id uuid PRIMARY KEY,
    blocker_id uuid NOT NULL REFERENCES public.users(id),
    blocked_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_user_blocks_pair UNIQUE(blocker_id,blocked_id),
    CONSTRAINT ck_user_blocks_other CHECK(blocker_id<>blocked_id)
);
CREATE INDEX ix_user_blocks_received ON public.user_blocks(blocked_id,blocker_id);
