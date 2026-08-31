-- Postgres enum 19종을 text + CHECK 로 바꾼다 (SOMA-462).
--
-- 발단은 `user_status_t` 에서 죽은 값 `suspended` 를 지우려던 것이다. Postgres 는 enum 값 삭제를
-- 지원하지 않는다(`dropping an enum value is not implemented`) — 값 하나를 걷어내려면 타입을
-- 새로 만들고 컬럼을 갈아끼우는 수술이 필요하다. 그 수술을 19종에 한 번에 하면서, 애초에 값
-- 목록이 바뀌는 것이 정상인 이 도메인에서 enum 이라는 그릇을 걷어낸다.
--
-- enum 은 파이썬 세대의 잔재다. 이 레포는 이미 text + CHECK 를 쓰고 있고
-- (`ck_practice_reports_report_type` · `ck_coaching_handoffs_branch_kind` ·
-- `ck_practice_sessions_blockage_branch`), 이 마이그레이션은 나머지를 그 패턴에 맞춘다.
-- 값 무결성은 DB 에 남는다 — 그릇만 바뀌고 규칙은 그대로다.
--
-- ⚠️ 순서가 중요하다. ①②를 빠뜨리면 ③이 거부당한다:
--   enum 을 참조하는 CHECK 와 부분 인덱스는 `ALTER TABLE … TYPE text` 가 자동으로 못 고친다.
--   `operator does not exist: text = content_status_t` 로 마이그레이션 전체가 실패한다.
--   (일반 인덱스 10개는 ALTER 가 알아서 재생성한다 — 손댈 필요 없다.)
--
-- 이 파일은 Flyway 가 트랜잭션 하나로 감싸므로 all-or-nothing 이다. 중간에 실패하면 스키마는
-- 온전한 채 앱만 안 뜬다. 성공한 뒤에는 옛 jar 로 못 돌아간다 — 옛 SQL 의 `::xxx_t` 캐스팅이
-- text 컬럼에서 깨진다. 되돌려야 하면 앞으로 굴린다(`.scratch/SOMA-462-V5-revert.sql` 참고).
--
-- 정렬이 조용히 바뀐다: enum 은 정의순, text 는 사전순이다. 실제로 순서가 보이는 두 곳
-- (`PostgresMemoryRepository` 의 기억 항목 · `PostgresConsentRepository` 의 동의 문서 목록)은
-- 같은 PR 에서 `ORDER BY CASE` 로 옛 순서를 고정했다.


-- ① enum 을 참조하는 CHECK 를 뗀다. 값 자체는 ⑤에서 캐스팅 없이 되돌린다.
ALTER TABLE public.actor_memory_entries
    DROP CONSTRAINT ck_actor_memory_demographics_actor_only;


-- ② 술어에 enum 리터럴이 든 부분 인덱스 2개를 뗀다. ④에서 되돌린다.
--    `idx_practice_sessions_user_visible_created` 는 술어가 `hidden_at IS NULL` 이라 무관하다.
DROP INDEX public.idx_community_posts_category_created;
DROP INDEX public.idx_community_posts_created;


-- ③ enum 컬럼 20개를 text 로. DEFAULT 가 있는 8개는 떼고 → 바꾸고 → 되돌린다
--    (DEFAULT 가 붙은 채로는 `default for column cannot be cast automatically` 로 막힌다).
ALTER TABLE public.actor_memory_entries
    ALTER COLUMN field TYPE text USING field::text,
    ALTER COLUMN written_by TYPE text USING written_by::text;

ALTER TABLE public.anomalies
    ALTER COLUMN intent_impact TYPE text USING intent_impact::text,
    ALTER COLUMN severity TYPE text USING severity::text;

ALTER TABLE public.coach_sessions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.coach_sessions
    ALTER COLUMN status TYPE text USING status::text,
    ALTER COLUMN close_reason TYPE text USING close_reason::text;
ALTER TABLE public.coach_sessions ALTER COLUMN status SET DEFAULT 'open';

ALTER TABLE public.coach_turns
    ALTER COLUMN role TYPE text USING role::text;

ALTER TABLE public.community_comments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.community_comments
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.community_comments ALTER COLUMN status SET DEFAULT 'visible';

ALTER TABLE public.community_posts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.community_posts
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.community_posts ALTER COLUMN status SET DEFAULT 'visible';

ALTER TABLE public.community_reports ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.community_reports
    ALTER COLUMN target_type TYPE text USING target_type::text,
    ALTER COLUMN reason TYPE text USING reason::text,
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.community_reports ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.consent_documents
    ALTER COLUMN type TYPE text USING type::text;

ALTER TABLE public.external_operations ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.external_operations
    ALTER COLUMN kind TYPE text USING kind::text,
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.external_operations ALTER COLUMN status SET DEFAULT 'pending';

-- `practice_sessions.status` 의 DEFAULT 는 되돌리지 않는다. 값이 `'created'` 였는데 연습 INSERT 가
-- 항상 `'analyzing'` 을 명시해 이 DEFAULT 가 발동한 적이 없다(운영·dev 0건 실측). 도달 불가능한
-- 값을 ⑥의 CHECK 에서 빼면서, 그 값을 가리키던 DEFAULT 도 함께 없앤다.
ALTER TABLE public.practice_sessions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.practice_sessions
    ALTER COLUMN status TYPE text USING status::text;

ALTER TABLE public.upload_intents ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.upload_intents
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.upload_intents ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.user_consents
    ALTER COLUMN action TYPE text USING action::text;

ALTER TABLE public.user_identities
    ALTER COLUMN provider TYPE text USING provider::text;

ALTER TABLE public.users ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.users
    ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.users ALTER COLUMN status SET DEFAULT 'active';


-- ④ 부분 인덱스 2개를 술어 캐스팅 없이 되돌린다.
CREATE INDEX idx_community_posts_category_created
    ON public.community_posts USING btree (category_id, created_at DESC, id DESC)
    WHERE (status = 'visible'::text);

CREATE INDEX idx_community_posts_created
    ON public.community_posts USING btree (created_at DESC, id DESC)
    WHERE (status = 'visible'::text);


-- ⑤ 성별·나이는 배우 본인만 적을 수 있다는 규칙을 되돌린다(캐스팅만 빠졌다).
ALTER TABLE public.actor_memory_entries
    ADD CONSTRAINT ck_actor_memory_demographics_actor_only
    CHECK (((field <> ALL (ARRAY['gender'::text, 'age'::text])) OR (written_by = 'actor'::text)));


-- ⑥ enum 이 갖고 있던 값 목록을 CHECK 로 옮긴다. 이름은 이 레포의 기존 규칙 `ck_<table>_<col>`,
--    스타일은 `= ANY (ARRAY[…])` 이다.
--
--    nullable 컬럼(`coach_sessions.close_reason`)도 `= ANY` 로 충분하다 — `NULL = ANY(…)` 는
--    unknown 이고 CHECK 는 unknown 을 통과시킨다.
--
--    두 목록만 옛 enum 과 다르다:
--      · `users.status` 에서 `suspended` 를 뺀다 — 계정을 정지시키는 경로가 코드에 없고
--        (`users.status` 를 UPDATE 하는 곳은 탈퇴의 `'deactivated'` 하나뿐), 운영·dev 0건이다.
--      · `practice_sessions.status` 에서 `created` 를 뺀다 — 위 ③ 주석의 도달 불가능한 값.
--
--    반대로 `content_status_t` 의 `hidden` 과 `report_status_t` 의 `actioned`·`dismissed` 는
--    쓰는 코드가 없어도 남긴다. 저건 의도가 앞에 있는 값이고(모더레이션 예약석), 수동 SQL 로
--    긴급 숨김 처리를 하는 목적지다 — 빼면 그 처리에 마이그레이션이 선행돼야 한다.
ALTER TABLE public.actor_memory_entries
    ADD CONSTRAINT ck_actor_memory_entries_field
    CHECK ((field = ANY (ARRAY['gender'::text, 'age'::text, 'goal'::text, 'blockage'::text, 'speech_self'::text, 'speech_actual'::text]))),
    ADD CONSTRAINT ck_actor_memory_entries_written_by
    CHECK ((written_by = ANY (ARRAY['actor'::text, 'agent'::text])));

ALTER TABLE public.anomalies
    ADD CONSTRAINT ck_anomalies_intent_impact
    CHECK ((intent_impact = ANY (ARRAY['반전'::text, '약화'::text, '국소'::text]))),
    ADD CONSTRAINT ck_anomalies_severity
    CHECK ((severity = ANY (ARRAY['high'::text, 'mid'::text, 'low'::text])));

ALTER TABLE public.coach_sessions
    ADD CONSTRAINT ck_coach_sessions_status
    CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    ADD CONSTRAINT ck_coach_sessions_close_reason
    CHECK ((close_reason = ANY (ARRAY['gap_stated'::text, 'exhausted'::text, 'limit'::text, 'user_ended'::text])));

ALTER TABLE public.coach_turns
    ADD CONSTRAINT ck_coach_turns_role
    CHECK ((role = ANY (ARRAY['ai'::text, 'actor'::text])));

ALTER TABLE public.community_comments
    ADD CONSTRAINT ck_community_comments_status
    CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text, 'deleted'::text])));

ALTER TABLE public.community_posts
    ADD CONSTRAINT ck_community_posts_status
    CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text, 'deleted'::text])));

ALTER TABLE public.community_reports
    ADD CONSTRAINT ck_community_reports_target_type
    CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text]))),
    ADD CONSTRAINT ck_community_reports_reason
    CHECK ((reason = ANY (ARRAY['spam'::text, 'abuse'::text, 'sexual'::text, 'privacy'::text, 'other'::text]))),
    ADD CONSTRAINT ck_community_reports_status
    CHECK ((status = ANY (ARRAY['pending'::text, 'actioned'::text, 'dismissed'::text])));

ALTER TABLE public.consent_documents
    ADD CONSTRAINT ck_consent_documents_type
    CHECK ((type = ANY (ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text])));

ALTER TABLE public.external_operations
    ADD CONSTRAINT ck_external_operations_kind
    CHECK ((kind = ANY (ARRAY['analyze'::text, 'coach_start'::text, 'coach_reply'::text, 'report'::text, 'memory_update'::text]))),
    ADD CONSTRAINT ck_external_operations_status
    CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text])));

ALTER TABLE public.practice_sessions
    ADD CONSTRAINT ck_practice_sessions_status
    CHECK ((status = ANY (ARRAY['analyzing'::text, 'analyzed'::text, 'failed'::text])));

ALTER TABLE public.upload_intents
    ADD CONSTRAINT ck_upload_intents_status
    CHECK ((status = ANY (ARRAY['pending'::text, 'finalized'::text, 'expired'::text])));

ALTER TABLE public.user_consents
    ADD CONSTRAINT ck_user_consents_action
    CHECK ((action = ANY (ARRAY['granted'::text, 'declined'::text, 'revoked'::text])));

ALTER TABLE public.user_identities
    ADD CONSTRAINT ck_user_identities_provider
    CHECK ((provider = ANY (ARRAY['google'::text, 'kakao'::text, 'apple'::text, 'development'::text])));

ALTER TABLE public.users
    ADD CONSTRAINT ck_users_status
    CHECK ((status = ANY (ARRAY['active'::text, 'deactivated'::text])));


-- ⑦ `users.role` — 권한 축을 위한 자리다.
--
-- ⚠️ 지금 이 컬럼을 읽는 코드는 없다. `/v2/admin/*` 은 사용자 토큰이 아니라 공유 시크릿
-- (`ADMIN_OPS_TOKEN`)으로 열리고, `AccessTokenFilter` 가 그 경로를 사용자 인증에서 제외한다.
-- 그래도 지금 넣는 이유는 이 마이그레이션이 어차피 `users` 를 재작성하기 때문이다 — 나중에
-- 따로 하면 마이그레이션·배포·기동 상한 리스크를 한 번 더 치른다. 컬럼 추가는 옛 jar 가 그냥
-- 무시하고 `ddl-auto: validate` 도 "테이블에만 있고 엔티티에 없는 컬럼"은 문제 삼지 않는다.
--
-- 값은 아무도 `admin` 이 아닌 채로 시작한다. 누구를 admin 으로 둘지는 별개 결정이다.
ALTER TABLE public.users
    ADD COLUMN role text DEFAULT 'user' NOT NULL,
    ADD CONSTRAINT ck_users_role CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])));


-- ⑧ 가입 시점 유입 출처 9컬럼을 지운다.
--
-- 쓰는 경로는 살아 있었지만(웹이 localStorage 의 UTM 을 로그인 요청에 실어 보내고 신규 가입일 때
-- INSERT) 읽는 쪽이 없다. 유일한 소비처였던 `/v2/admin/stats` 는 같은 PR 에서 은퇴한다.
--
-- 광고 분석은 이 컬럼들이 아니라 GA4 를 본다 — 별도 경로(GA4 Data API → ops 대시보드)이고,
-- 세션 단위라 가입자 단위인 이쪽과 애초에 다른 것을 센다. 웹의 GA4 태깅은 그대로 둔다.
--
-- 지우기 전 운영 값을 CSV 로 아카이브한다(머지 전 절차). 소급 복구 불가를 그것으로 없앤다.
ALTER TABLE public.users
    DROP COLUMN signup_utm_source,
    DROP COLUMN signup_utm_medium,
    DROP COLUMN signup_utm_campaign,
    DROP COLUMN signup_utm_content,
    DROP COLUMN signup_utm_term,
    DROP COLUMN signup_utm_id,
    DROP COLUMN signup_referrer_host,
    DROP COLUMN signup_landing_path,
    DROP COLUMN signup_first_seen_at;


-- ⑨ 이제 아무 컬럼도 참조하지 않는 enum 타입 19종을 지운다.
DROP TYPE public.actor_memory_author_t;
DROP TYPE public.actor_memory_field_t;
DROP TYPE public.close_reason_t;
DROP TYPE public.consent_action_t;
DROP TYPE public.consent_type_t;
DROP TYPE public.content_status_t;
DROP TYPE public.identity_provider_t;
DROP TYPE public.intent_impact_t;
DROP TYPE public.operation_kind_t;
DROP TYPE public.operation_status_t;
DROP TYPE public.practice_status_t;
DROP TYPE public.report_reason_t;
DROP TYPE public.report_status_t;
DROP TYPE public.report_target_type_t;
DROP TYPE public.session_status_t;
DROP TYPE public.severity_t;
DROP TYPE public.turn_role_t;
DROP TYPE public.upload_status_t;
DROP TYPE public.user_status_t;
