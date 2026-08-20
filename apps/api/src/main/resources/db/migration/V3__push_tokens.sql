-- 푸시 알림 수신 단말 (SOMA-427).
--
-- 분석은 백그라운드에서 수 분 걸리고, 그동안 배우가 앱을 떠나면 끝났음을 알 길이 없다.
-- 로그인한 단말이 Expo push token 을 등록해 두면, 분석이 완료 전이될 때 서버가 그 토큰으로
-- "질문이 준비됐어요" 를 보낸다.
--
-- 토큰이 곧 단말이다 — 같은 사용자가 폰을 바꾸면 토큰이 새로 오고, 같은 폰에 다른 계정이
-- 로그인하면 소유자가 바뀐다. 그래서 토큰이 UNIQUE 이고 등록은 upsert 다.
--
-- 탈퇴 시에는 행을 지운다. users 행 자체는 탈퇴해도 남으므로(글타래 보존) FK CASCADE 로는
-- 정리되지 않고, PostgresProfileRepository.deactivate 가 파기 트랜잭션 안에서 함께 지운다.
CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT push_tokens_token_key UNIQUE (token),
    CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_push_tokens_user ON public.push_tokens USING btree (user_id);
