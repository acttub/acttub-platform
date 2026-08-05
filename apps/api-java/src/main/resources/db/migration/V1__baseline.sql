-- V1__baseline.sql — acting-api 스키마 동결본
--
-- alembic 0001~0006 을 빈 DB 에 upgrade head 한 결과를
-- `pg_dump --schema-only --no-owner --no-privileges --exclude-table=alembic_version`
-- 로 덤프해 만들었다. 손으로 고친 부분은 아래 세 가지뿐이다.
--   1. psql 메타커맨드(\restrict/\unrestrict)와 SET/set_config 프리앰블 제거
--      (Flyway 는 psql 이 아니라 JDBC 로 실행한다)
--   2. 0005 의 op.bulk_insert 로 들어가던 community_categories 시드를 파일 끝에 추가
--   3. 이 주석 블록
--
-- 이 파일이 스키마의 단일 소유자다. 빈 DB 는 이 파일로 재구축되고,
-- alembic 이 이미 만들어 둔 DB(dev·운영)에는 baseline 으로 기록만 된다.
-- 새 마이그레이션을 여기에 덧붙이지 않는다 — V2 이후로 따로 만든다.

--
-- Name: close_reason_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.close_reason_t AS ENUM (
    'gap_stated',
    'exhausted',
    'limit',
    'user_ended'
);

--
-- Name: consent_action_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_action_t AS ENUM (
    'granted',
    'declined',
    'revoked'
);

--
-- Name: consent_type_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_type_t AS ENUM (
    'terms',
    'privacy',
    'ai_analysis'
);

--
-- Name: content_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_status_t AS ENUM (
    'visible',
    'hidden',
    'deleted'
);

--
-- Name: identity_provider_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.identity_provider_t AS ENUM (
    'google',
    'kakao',
    'apple',
    'development'
);

--
-- Name: intent_impact_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.intent_impact_t AS ENUM (
    '반전',
    '약화',
    '국소'
);

--
-- Name: operation_kind_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.operation_kind_t AS ENUM (
    'analyze',
    'coach_start',
    'coach_reply',
    'report'
);

--
-- Name: operation_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.operation_status_t AS ENUM (
    'pending',
    'running',
    'succeeded',
    'failed'
);

--
-- Name: practice_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.practice_status_t AS ENUM (
    'created',
    'analyzing',
    'analyzed',
    'failed'
);

--
-- Name: report_reason_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_reason_t AS ENUM (
    'spam',
    'abuse',
    'sexual',
    'privacy',
    'other'
);

--
-- Name: report_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_status_t AS ENUM (
    'pending',
    'actioned',
    'dismissed'
);

--
-- Name: report_target_type_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_target_type_t AS ENUM (
    'post',
    'comment'
);

--
-- Name: session_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status_t AS ENUM (
    'open',
    'closed'
);

--
-- Name: severity_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.severity_t AS ENUM (
    'high',
    'mid',
    'low'
);

--
-- Name: turn_role_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.turn_role_t AS ENUM (
    'ai',
    'actor'
);

--
-- Name: upload_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.upload_status_t AS ENUM (
    'pending',
    'finalized',
    'expired'
);

--
-- Name: user_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status_t AS ENUM (
    'active',
    'suspended'
);

--
-- Name: anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anomalies (
    id bigint NOT NULL,
    summary_id uuid NOT NULL,
    sort_order integer NOT NULL,
    start_ts text NOT NULL,
    end_ts text NOT NULL,
    dimension text NOT NULL,
    what text NOT NULL,
    why_odd text NOT NULL,
    likely_cause text NOT NULL,
    impact_on_intent text NOT NULL,
    overlaps_key_moment boolean DEFAULT false NOT NULL,
    on_key_dimension boolean DEFAULT false NOT NULL,
    intent_impact public.intent_impact_t NOT NULL,
    severity public.severity_t NOT NULL,
    severity_reason text NOT NULL
);

--
-- Name: anomalies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.anomalies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: anomalies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.anomalies_id_seq OWNED BY public.anomalies.id;

--
-- Name: coach_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_sessions (
    id uuid NOT NULL,
    summary_id uuid NOT NULL,
    status public.session_status_t DEFAULT 'open'::public.session_status_t NOT NULL,
    close_reason public.close_reason_t,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: coach_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_turns (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    role public.turn_role_t NOT NULL,
    text text NOT NULL,
    action text,
    focus_timestamp text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: coach_turns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coach_turns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: coach_turns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coach_turns_id_seq OWNED BY public.coach_turns.id;

--
-- Name: community_anonymous_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_anonymous_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    ordinal integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: community_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_community_blocks_not_self CHECK ((blocker_id <> blocked_id))
);

--
-- Name: community_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: community_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    status public.content_status_t DEFAULT 'visible'::public.content_status_t NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymous boolean DEFAULT false NOT NULL
);

--
-- Name: community_post_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_post_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status public.content_status_t DEFAULT 'visible'::public.content_status_t NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymous boolean DEFAULT false NOT NULL
);

--
-- Name: community_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    target_type public.report_target_type_t NOT NULL,
    target_id uuid NOT NULL,
    reason public.report_reason_t NOT NULL,
    detail text,
    status public.report_status_t DEFAULT 'pending'::public.report_status_t NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: consent_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.consent_type_t NOT NULL,
    version text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: external_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    kind public.operation_kind_t NOT NULL,
    status public.operation_status_t DEFAULT 'pending'::public.operation_status_t NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    request_fingerprint character(64) NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    error_code text,
    response_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    upload_intent_id uuid NOT NULL,
    status public.practice_status_t DEFAULT 'created'::public.practice_status_t NOT NULL,
    situation text NOT NULL,
    character_context text NOT NULL,
    subtext text NOT NULL,
    hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    replaced_by_id uuid,
    token_hash character(64) NOT NULL,
    device_info text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    headline text NOT NULL,
    biggest_problem jsonb NOT NULL,
    evidence text NOT NULL,
    self_discovery text NOT NULL,
    encouragement text NOT NULL,
    next_step text NOT NULL,
    comparison text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    observation jsonb NOT NULL,
    summary text NOT NULL,
    intent_alignment text NOT NULL,
    key_moment text NOT NULL,
    key_dimension text NOT NULL,
    model text NOT NULL,
    was_compressed boolean DEFAULT false NOT NULL,
    raw jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: upload_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status public.upload_status_t DEFAULT 'pending'::public.upload_status_t NOT NULL,
    storage_provider text NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    duration_ms integer,
    etag text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    finalized_at timestamp with time zone
);

--
-- Name: user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    document_id uuid NOT NULL,
    action public.consent_action_t NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider public.identity_provider_t NOT NULL,
    provider_uid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    status public.user_status_t DEFAULT 'active'::public.user_status_t NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nickname text
);

--
-- Name: anomalies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomalies ALTER COLUMN id SET DEFAULT nextval('public.anomalies_id_seq'::regclass);

--
-- Name: coach_turns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_turns ALTER COLUMN id SET DEFAULT nextval('public.coach_turns_id_seq'::regclass);

--
-- Name: anomalies anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomalies
    ADD CONSTRAINT anomalies_pkey PRIMARY KEY (id);

--
-- Name: coach_sessions coach_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_sessions
    ADD CONSTRAINT coach_sessions_pkey PRIMARY KEY (id);

--
-- Name: coach_turns coach_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_turns
    ADD CONSTRAINT coach_turns_pkey PRIMARY KEY (id);

--
-- Name: community_anonymous_aliases community_anonymous_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_anonymous_aliases
    ADD CONSTRAINT community_anonymous_aliases_pkey PRIMARY KEY (id);

--
-- Name: community_blocks community_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_blocks
    ADD CONSTRAINT community_blocks_pkey PRIMARY KEY (id);

--
-- Name: community_categories community_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_categories
    ADD CONSTRAINT community_categories_pkey PRIMARY KEY (id);

--
-- Name: community_categories community_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_categories
    ADD CONSTRAINT community_categories_slug_key UNIQUE (slug);

--
-- Name: community_comments community_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_pkey PRIMARY KEY (id);

--
-- Name: community_post_likes community_post_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_likes
    ADD CONSTRAINT community_post_likes_pkey PRIMARY KEY (id);

--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);

--
-- Name: community_reports community_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT community_reports_pkey PRIMARY KEY (id);

--
-- Name: consent_documents consent_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_documents
    ADD CONSTRAINT consent_documents_pkey PRIMARY KEY (id);

--
-- Name: external_operations external_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_operations
    ADD CONSTRAINT external_operations_pkey PRIMARY KEY (id);

--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);

--
-- Name: practice_sessions practice_sessions_upload_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_upload_intent_id_key UNIQUE (upload_intent_id);

--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);

--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

--
-- Name: reports reports_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_session_id_key UNIQUE (session_id);

--
-- Name: summaries summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.summaries
    ADD CONSTRAINT summaries_pkey PRIMARY KEY (id);

--
-- Name: summaries summaries_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.summaries
    ADD CONSTRAINT summaries_session_id_key UNIQUE (session_id);

--
-- Name: upload_intents upload_intents_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_object_key_key UNIQUE (object_key);

--
-- Name: upload_intents upload_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_pkey PRIMARY KEY (id);

--
-- Name: coach_turns uq_coach_turns_session_index; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_turns
    ADD CONSTRAINT uq_coach_turns_session_index UNIQUE (session_id, turn_index);

--
-- Name: community_anonymous_aliases uq_community_alias_post_ordinal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_anonymous_aliases
    ADD CONSTRAINT uq_community_alias_post_ordinal UNIQUE (post_id, ordinal);

--
-- Name: community_anonymous_aliases uq_community_alias_post_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_anonymous_aliases
    ADD CONSTRAINT uq_community_alias_post_user UNIQUE (post_id, user_id);

--
-- Name: community_blocks uq_community_blocks_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_blocks
    ADD CONSTRAINT uq_community_blocks_pair UNIQUE (blocker_id, blocked_id);

--
-- Name: community_post_likes uq_community_post_likes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_likes
    ADD CONSTRAINT uq_community_post_likes UNIQUE (post_id, user_id);

--
-- Name: community_reports uq_community_reports_reporter_target; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT uq_community_reports_reporter_target UNIQUE (reporter_id, target_type, target_id);

--
-- Name: consent_documents uq_consent_documents_type_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_documents
    ADD CONSTRAINT uq_consent_documents_type_version UNIQUE (type, version);

--
-- Name: external_operations uq_external_operations_user_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_operations
    ADD CONSTRAINT uq_external_operations_user_request UNIQUE (user_id, request_id);

--
-- Name: user_identities uq_user_identities_provider_uid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT uq_user_identities_provider_uid UNIQUE (provider, provider_uid);

--
-- Name: user_consents user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_pkey PRIMARY KEY (id);

--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);

--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: idx_anomalies_summary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_anomalies_summary ON public.anomalies USING btree (summary_id, sort_order);

--
-- Name: idx_community_alias_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_alias_post ON public.community_anonymous_aliases USING btree (post_id, ordinal);

--
-- Name: idx_community_blocks_blocker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_blocks_blocker ON public.community_blocks USING btree (blocker_id);

--
-- Name: idx_community_comments_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_comments_author ON public.community_comments USING btree (author_id);

--
-- Name: idx_community_comments_post_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_comments_post_created ON public.community_comments USING btree (post_id, created_at, id);

--
-- Name: idx_community_post_likes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_post_likes_user ON public.community_post_likes USING btree (user_id);

--
-- Name: idx_community_posts_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_posts_author ON public.community_posts USING btree (author_id);

--
-- Name: idx_community_posts_category_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_posts_category_created ON public.community_posts USING btree (category_id, created_at DESC, id DESC) WHERE (status = 'visible'::public.content_status_t);

--
-- Name: idx_community_posts_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_posts_created ON public.community_posts USING btree (created_at DESC, id DESC) WHERE (status = 'visible'::public.content_status_t);

--
-- Name: idx_community_reports_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_reports_status_created ON public.community_reports USING btree (status, created_at DESC);

--
-- Name: idx_consent_documents_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_documents_latest ON public.consent_documents USING btree (type, published_at DESC);

--
-- Name: idx_external_operations_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_operations_claimable ON public.external_operations USING btree (kind, status, created_at);

--
-- Name: idx_external_operations_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_operations_session ON public.external_operations USING btree (session_id);

--
-- Name: idx_external_operations_status_attempt_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_operations_status_attempt_lease ON public.external_operations USING btree (status, attempt_count, lease_expires_at);

--
-- Name: idx_practice_sessions_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_status_updated ON public.practice_sessions USING btree (status, updated_at);

--
-- Name: idx_practice_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_user ON public.practice_sessions USING btree (user_id);

--
-- Name: idx_practice_sessions_user_visible_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_user_visible_created ON public.practice_sessions USING btree (user_id, created_at DESC) WHERE (hidden_at IS NULL);

--
-- Name: idx_refresh_tokens_user_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_expires ON public.refresh_tokens USING btree (user_id, expires_at);

--
-- Name: idx_reports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_created ON public.reports USING btree (created_at DESC);

--
-- Name: idx_sessions_summary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_summary ON public.coach_sessions USING btree (summary_id);

--
-- Name: idx_turns_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_turns_session ON public.coach_turns USING btree (session_id, turn_index);

--
-- Name: idx_upload_intents_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_intents_expiry ON public.upload_intents USING btree (status, expires_at);

--
-- Name: idx_upload_intents_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upload_intents_user_created ON public.upload_intents USING btree (user_id, created_at DESC);

--
-- Name: idx_user_consents_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_consents_current ON public.user_consents USING btree (user_id, document_id, occurred_at DESC);

--
-- Name: idx_user_identities_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_identities_user ON public.user_identities USING btree (user_id);

--
-- Name: anomalies anomalies_summary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anomalies
    ADD CONSTRAINT anomalies_summary_id_fkey FOREIGN KEY (summary_id) REFERENCES public.summaries(id) ON DELETE CASCADE;

--
-- Name: coach_sessions coach_sessions_summary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_sessions
    ADD CONSTRAINT coach_sessions_summary_id_fkey FOREIGN KEY (summary_id) REFERENCES public.summaries(id);

--
-- Name: coach_turns coach_turns_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_turns
    ADD CONSTRAINT coach_turns_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.coach_sessions(id) ON DELETE CASCADE;

--
-- Name: community_anonymous_aliases community_anonymous_aliases_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_anonymous_aliases
    ADD CONSTRAINT community_anonymous_aliases_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id);

--
-- Name: community_anonymous_aliases community_anonymous_aliases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_anonymous_aliases
    ADD CONSTRAINT community_anonymous_aliases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: community_blocks community_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_blocks
    ADD CONSTRAINT community_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id);

--
-- Name: community_blocks community_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_blocks
    ADD CONSTRAINT community_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id);

--
-- Name: community_comments community_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);

--
-- Name: community_comments community_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id);

--
-- Name: community_post_likes community_post_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_likes
    ADD CONSTRAINT community_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id);

--
-- Name: community_post_likes community_post_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_likes
    ADD CONSTRAINT community_post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: community_posts community_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);

--
-- Name: community_posts community_posts_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.community_categories(id);

--
-- Name: community_reports community_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reports
    ADD CONSTRAINT community_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);

--
-- Name: external_operations external_operations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_operations
    ADD CONSTRAINT external_operations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id);

--
-- Name: external_operations external_operations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_operations
    ADD CONSTRAINT external_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: practice_sessions practice_sessions_upload_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_upload_intent_id_fkey FOREIGN KEY (upload_intent_id) REFERENCES public.upload_intents(id);

--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: refresh_tokens refresh_tokens_replaced_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_replaced_by_id_fkey FOREIGN KEY (replaced_by_id) REFERENCES public.refresh_tokens(id);

--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: reports reports_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.coach_sessions(id);

--
-- Name: summaries summaries_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.summaries
    ADD CONSTRAINT summaries_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;

--
-- Name: upload_intents upload_intents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: user_consents user_consents_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.consent_documents(id);

--
-- Name: user_consents user_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_consents
    ADD CONSTRAINT user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- PostgreSQL database dump complete
--

--
-- 커뮤니티 카테고리 시드 (alembic 0005 op.bulk_insert 대응)
-- id 는 DB 가 gen_random_uuid() 로 만든다 — alembic 도 동일하게 동작했다.
--

INSERT INTO public.community_categories (slug, name, description, sort_order) VALUES
    ('free', '자유', '연습하다 든 생각, 근황, 잡담', 10),
    ('admission', '입시 Q&A', '실기·전형·준비 과정에서 막힌 것 묻기', 20),
    ('info', '정보공유', '공고·후기·자료처럼 남에게 도움 되는 것', 30)
ON CONFLICT (slug) DO NOTHING;
