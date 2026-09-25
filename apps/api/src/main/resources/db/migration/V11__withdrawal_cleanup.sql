-- 탈퇴 뒤에 남는 바깥 정리와 네이버 토큰 (SOMA-528, account.withdraw · account.login, 결정 I-7·I-10).
--
-- ⚠️ 이 파일도 넓히기만 한다(V9 머리말과 같은 규칙). 기존 테이블에 더하는 컬럼은 NULL 허용이고,
-- 새 테이블은 직전 운영 태그의 서버가 모르는 것이라 되돌려도 그 서버가 그대로 뜬다.


-- ① user_identities — 네이버 refresh token 의 암호문.
--
--    네이버는 앱이 아니라 서버가 authorization code 를 교환한다(결정 I-5). 그때 받은 refresh token 을
--    암호화해 두었다가 탈퇴 때 토큰 폐기(연동 해제)에 쓴다 — 애플 토큰(`apple_token_encrypted`)과 같은
--    방식이다. 로그인할 때마다 새 값으로 바뀐다. 평문을 넣지 않는다. 탈퇴하면 비운다.
ALTER TABLE public.user_identities
    ADD COLUMN naver_token_encrypted text;


-- ② account_cleanup_operations — 탈퇴 트랜잭션 밖에서 하는 정리의 장부.
--
--    탈퇴는 한 트랜잭션에서 끝나고, 바깥 호출(저장소의 객체 삭제, 애플 폐기·카카오 끊기·네이버 토큰
--    폐기)은 그 뒤에 한다. 바깥 호출이 실패해도 탈퇴는 끝나며 여기 남은 행을 7일 동안 다시 시도한다.
--    성공하거나 7일이 지나면 행을 지운다 — 그래서 이 표에는 끝난 것이 남지 않는다.
--
--    `external_operations` 에 넣지 않는 이유: 그 장부는 연습 세션에 매여 있고(`session_id NOT NULL`)
--    "최대 3회 뒤 FAILED" 가 고정 계약이다(CONTRACT.md §5-7). 세션이 없고 7일을 가는 이 정리와
--    규칙이 다르다. 장부 통합은 연습 영역 재설계(ai_jobs)의 일이다.
--
--    `payload_encrypted` 에는 해제에 필요한 값(애플 토큰, 카카오 회원번호, 네이버 refresh token,
--    지울 객체 키 목록)이 들어간다. 탈퇴가 신원을 파기하기 전에 이리로 옮긴 것이라 평문을 넣지
--    않는다. 값 앞의 접두사가 어느 키로 암호화했는지를 말한다(결정 I-11).
--
--    `user_id` 에 FK 를 걸되 CASCADE 는 두지 않는다 — users 행은 탈퇴해도 남는다.
CREATE TABLE public.account_cleanup_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    payload_encrypted text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_cleanup_operations_pkey PRIMARY KEY (id),
    CONSTRAINT account_cleanup_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT ck_account_cleanup_operations_kind
        CHECK ((kind = ANY (ARRAY['object_delete'::text, 'apple_revoke'::text, 'kakao_unlink'::text, 'naver_revoke'::text])))
);

CREATE INDEX idx_account_cleanup_operations_due
    ON public.account_cleanup_operations USING btree (next_attempt_at);
CREATE INDEX idx_account_cleanup_operations_user
    ON public.account_cleanup_operations USING btree (user_id);
