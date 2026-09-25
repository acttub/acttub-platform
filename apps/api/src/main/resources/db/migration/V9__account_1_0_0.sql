-- 계정 1.0.0 스키마 (SOMA-528). 근거는 docs/requirements/00-common.md 「ERD에 반영할 변경」과
-- 01-account.md 의 각 기능이다.
--
-- ⚠️ 이 파일은 넓히기만 한다(expand). 직전 운영 태그의 서버로 되돌려도 그 서버가 그대로 뜨고
-- 그대로 써야 한다(docs/BRANCHING-STRATEGY.md 「DB와 배포 안전성」):
--   · 기존 테이블에 더하는 컬럼은 전부 NULL 허용이다 — 옛 서버의 INSERT 는 이 컬럼을 모른다.
--   · 기존 CHECK 는 값을 더하기만 한다.
--   · NOT NULL 은 풀기만 한다. `ddl-auto: validate` 는 여분의 테이블·컬럼·CHECK·NULL 허용을
--     문제 삼지 않는다.
--   · `users.nickname` 은 **지우지 않는다.** 옛 서버가 그 컬럼을 Entity 에 매핑하고 있어 없으면
--     기동하지 못한다. 여기서는 값을 `user_profiles.name` 으로 복사만 하고, 새 서버는 이 컬럼을
--     읽지 않는다(쓰는 곳은 탈퇴의 파기 하나). 컬럼 삭제는 그 쓰기까지 걷어낸 다음 릴리스의 일이다.
--
-- 값 목록은 text + CHECK 다(ADR-023, CONTRACT.md §5-3-1). 값 이름은 DB 값이자 API 값이다.
-- community_* 와 연습 영역 테이블은 건드리지 않는다.


-- ① users — 게스트의 "만 14세 이상이에요" 확인 시각(account.guest).
--    게스트는 생년월일을 내지 않으므로 이것이 만 14세 미만을 거르는 유일한 기록이다.
ALTER TABLE public.users
    ADD COLUMN age_confirmed_at timestamp with time zone;


-- ② user_identities — 제공자 둘과 게스트, 탈퇴 뒤 남기는 해시, 애플 토큰.
--
--    탈퇴하면 `provider_uid` 를 비우고 서버 비밀키의 HMAC 을 `uid_hash` 에 남긴다(account.withdraw,
--    ADR-029). 그래서 `provider_uid` 의 NOT NULL 을 푼다. `uq_user_identities_provider_uid` 는
--    NULL 을 서로 다른 값으로 보므로 탈퇴한 신원 여럿이 한 제공자에 함께 남는다.
--    같은 제공자 계정이 재가입 뒤 다시 탈퇴하면 같은 해시가 또 남으므로 해시에는 UNIQUE 가 없다.
--
--    `apple_token_encrypted` 는 로그인 때 authorization code 로 바꿔 온 애플 토큰의 암호문이고
--    탈퇴 때 폐기 API 에 쓴다(account.login). 평문을 넣지 않는다.
ALTER TABLE public.user_identities
    ALTER COLUMN provider_uid DROP NOT NULL,
    ADD COLUMN uid_hash text,
    ADD COLUMN apple_token_encrypted text,
    ADD CONSTRAINT ck_user_identities_uid_or_hash
        CHECK (((provider_uid IS NOT NULL) OR (uid_hash IS NOT NULL)));

ALTER TABLE public.user_identities DROP CONSTRAINT ck_user_identities_provider;
ALTER TABLE public.user_identities
    ADD CONSTRAINT ck_user_identities_provider
    CHECK ((provider = ANY (ARRAY['google'::text, 'kakao'::text, 'apple'::text, 'naver'::text, 'guest'::text, 'development'::text])));

-- 보관 동의 철회 요청에서 운영자가 해시로 옛 신원을 찾는다. 해시가 있는 행은 탈퇴한 신원뿐이다.
CREATE INDEX idx_user_identities_uid_hash
    ON public.user_identities USING btree (uid_hash)
    WHERE (uid_hash IS NOT NULL);


-- ③ consent_documents — 선택 문서 "탈퇴 후 영상·녹음 보관·활용"(account.consent).
--    문서의 새 판은 서버가 시작할 때 배포 파일에서 발행한다. 여기서는 그릇만 넓힌다.
ALTER TABLE public.consent_documents DROP CONSTRAINT ck_consent_documents_type;
ALTER TABLE public.consent_documents
    ADD CONSTRAINT ck_consent_documents_type
    CHECK ((type = ANY (ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text])));


-- ④ user_profiles — 회원당 하나(account.profile · account.notification · account.withdraw).
--
--    필수 여섯 항목(이름·성별·생년월일·방향·경력·목표)의 컬럼이 **NULL 을 허용한다.** 1.0.0 이전
--    회원은 옛 닉네임만 들고 오고(아래 ⑩), 다 채웠는지는 게이트가 요청마다 판정한다. 탈퇴하면
--    이름·사진·소개와 생년월일을 지우고 생년월일은 5세 단위 연령대(`age_band`, 구간의 아래 끝:
--    25 = 만 25~29세)로 뭉개 남긴다.
--
--    추구하는 방향은 복수 선택이라 ⑤에 따로 둔다. 알림 토글 셋의 기본값은 모두 켜짐이다.
--    게스트는 프로필 행이 없다.
CREATE TABLE public.user_profiles (
    user_id uuid NOT NULL,
    name text,
    gender text,
    birth_date date,
    experience text,
    goal text,
    photo_key text,
    bio text,
    age_band integer,
    notify_analysis_done boolean DEFAULT true NOT NULL,
    notify_challenge boolean DEFAULT true NOT NULL,
    notify_evening_reminder boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT ck_user_profiles_gender
        CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'unspecified'::text]))),
    CONSTRAINT ck_user_profiles_experience
        CHECK ((experience = ANY (ARRAY['before_start'::text, 'exam_prep'::text, 'under_1y'::text, 'y1_to_3'::text, 'y3_to_5'::text, 'over_5y'::text]))),
    CONSTRAINT ck_user_profiles_goal
        CHECK ((goal = ANY (ARRAY['hobby'::text, 'audition'::text, 'professional'::text]))),
    CONSTRAINT ck_user_profiles_age_band
        CHECK (((age_band >= 0) AND ((age_band % 5) = 0)))
);


-- ⑤ user_profile_directions — 고른 방향마다 한 행(account.profile).
CREATE TABLE public.user_profile_directions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    direction text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_profile_directions_pkey PRIMARY KEY (id),
    CONSTRAINT uq_user_profile_directions_user_direction UNIQUE (user_id, direction),
    CONSTRAINT user_profile_directions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    CONSTRAINT ck_user_profile_directions_direction
        CHECK ((direction = ANY (ARRAY['media'::text, 'stage'::text])))
);


-- ⑥ portfolios — 회원당 하나, 처음 편집할 때 생긴다(account.portfolio, ADR-030).
--    공유 링크는 기본 꺼짐이다. slug 는 처음 켤 때 생기고 꺼도 남아, 다시 켜면 같은 주소가 열린다.
--    탈퇴하면 행째 지우고 경력·사진이 따라 지워진다.
CREATE TABLE public.portfolios (
    user_id uuid NOT NULL,
    intro text,
    share_enabled boolean DEFAULT false NOT NULL,
    share_slug text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolios_pkey PRIMARY KEY (user_id),
    CONSTRAINT uq_portfolios_share_slug UNIQUE (share_slug),
    CONSTRAINT portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT ck_portfolios_share_needs_slug
        CHECK (((NOT share_enabled) OR (share_slug IS NOT NULL)))
);


-- ⑦ portfolio_credits — 경력 여러 개, 순서 있음.
--    `sort_order` 에 UNIQUE 를 걸지 않는다 — 순서 바꾸기가 여러 행을 한 문장씩 고치는 동안 값이 겹친다.
CREATE TABLE public.portfolio_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    role text NOT NULL,
    year integer NOT NULL,
    kind text NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portfolio_credits_pkey PRIMARY KEY (id),
    CONSTRAINT portfolio_credits_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.portfolios(user_id) ON DELETE CASCADE,
    CONSTRAINT ck_portfolio_credits_kind
        CHECK ((kind = ANY (ARRAY['film'::text, 'drama'::text, 'play'::text, 'musical'::text, 'ad'::text, 'other'::text])))
);

CREATE INDEX idx_portfolio_credits_user_order
    ON public.portfolio_credits USING btree (user_id, sort_order);


-- ⑧ portfolio_photos — 사진 여러 장, 순서 있음. 객체는 영상과 같은 저장소에 두되 videos·프로필
--    사진과 별개다. 올리기는 영상과 같이 "주소 받기 → 직접 올리기 → 끝 알리기" 라, 끝나기 전의
--    행은 `uploaded_at` 이 비어 있고 목록 끝에 붙을 때 `sort_order` 를 얻는다.
CREATE TABLE public.portfolio_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    uploaded_at timestamp with time zone,
    CONSTRAINT portfolio_photos_pkey PRIMARY KEY (id),
    CONSTRAINT portfolio_photos_object_key_key UNIQUE (object_key),
    CONSTRAINT portfolio_photos_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.portfolios(user_id) ON DELETE CASCADE,
    CONSTRAINT ck_portfolio_photos_uploaded_has_order
        CHECK (((uploaded_at IS NULL) OR (sort_order IS NOT NULL)))
);

CREATE INDEX idx_portfolio_photos_user_order
    ON public.portfolio_photos USING btree (user_id, sort_order);


-- ⑨ guest_transfer_codes — 웹 게스트의 자료를 앱 회원에게 옮기는 여섯 자리 코드(account.guest, ADR-028).
--    해시만 저장한다. 10분·1회용이고 새로 받으면 이전 코드는 무효다 — 그 규칙은 애플리케이션이
--    지킨다. 여섯 자리라 서로 다른 게스트의 코드가 겹칠 수 있어 해시에 UNIQUE 를 걸지 않는다.
CREATE TABLE public.guest_transfer_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT guest_transfer_codes_pkey PRIMARY KEY (id),
    CONSTRAINT guest_transfer_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_guest_transfer_codes_user ON public.guest_transfer_codes USING btree (user_id);
CREATE INDEX idx_guest_transfer_codes_code_hash ON public.guest_transfer_codes USING btree (code_hash);


-- ⑩ 기존 회원의 닉네임을 이름으로 복사한다(account.profile).
--
--    1.0.0 이전 회원은 첫 로그인 때 옛 닉네임이 이름 칸에 채워진 프로필 화면을 만난다. 나머지
--    필수 항목은 비어 있어 게이트가 profile_required 로 답한다.
--
--    · 닉네임이 없거나 공백뿐인 회원은 행을 만들지 않는다 — 프로필이 없는 것과 같다.
--    · 탈퇴한 계정은 건너뛴다. 탈퇴가 닉네임을 비우므로 없어야 정상이지만, 남아 있더라도 탈퇴한
--      사람의 이름을 새 테이블로 퍼뜨리지 않는다.
--    · `users.nickname` 은 그대로 둔다(파일 머리말).
INSERT INTO public.user_profiles (user_id, name)
SELECT id, nickname
FROM public.users
WHERE status = 'active'
  AND nickname IS NOT NULL
  AND btrim(nickname) <> '';
