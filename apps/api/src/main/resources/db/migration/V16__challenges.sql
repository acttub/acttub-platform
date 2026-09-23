-- 챌린지 개설. 기존 연습·영상·계정 표는 보존한다(04-challenge, ADR-032).
CREATE TABLE public.challenges (
    id uuid PRIMARY KEY,
    line text NOT NULL,
    work text NOT NULL,
    character text,
    scene_note text,
    duration_days integer NOT NULL,
    origin text NOT NULL,
    host_user_id uuid REFERENCES public.users(id),
    request_id uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    featured_on date,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    moderation text DEFAULT 'visible' NOT NULL,
    deleted_at timestamp with time zone,
    ranking_state text,
    finalized_at timestamp with time zone,
    CONSTRAINT uq_challenges_request UNIQUE (host_user_id, request_id),
    CONSTRAINT uq_challenges_featured UNIQUE (featured_on),
    CONSTRAINT ck_challenges_origin CHECK (origin IN ('team','member')),
    CONSTRAINT ck_challenges_moderation CHECK (moderation IN ('visible','review','hidden')),
    CONSTRAINT ck_challenges_ranking_state CHECK (ranking_state IN ('pending','final')),
    CONSTRAINT ck_challenges_period CHECK (ends_at > starts_at),
    CONSTRAINT ck_challenges_team CHECK (origin <> 'team' OR host_user_id IS NULL),
    CONSTRAINT ck_challenges_featured_team CHECK (featured_on IS NULL OR origin = 'team'),
    CONSTRAINT ck_challenges_line_length CHECK (char_length(line) BETWEEN 1 AND 200),
    CONSTRAINT ck_challenges_work_length CHECK (char_length(work) BETWEEN 1 AND 100),
    CONSTRAINT ck_challenges_character_length CHECK (char_length(character) <= 100),
    CONSTRAINT ck_challenges_scene_note_length CHECK (char_length(scene_note) <= 500)
);
CREATE UNIQUE INDEX uq_challenges_team_request ON public.challenges (request_id) WHERE origin='team';
CREATE INDEX ix_challenges_host_created ON public.challenges (host_user_id, starts_at);
CREATE INDEX ix_challenges_visible_ends ON public.challenges (ends_at, starts_at, id)
    WHERE moderation='visible' AND deleted_at IS NULL;
