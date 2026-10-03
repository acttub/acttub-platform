-- 신원마다 마지막으로 로그인한 시각 (account.login).
--
-- 이메일 겹침 409 의 `providers` 를 최근에 로그인한 신원부터 준다. 앱은 그 첫 번째로 "{제공자}로 계속하기"를
-- 묻는다. 로그인할 때마다 갱신하고(PostgresAuthRepository#markIdentityUsed), 가입 제출로 생기는 신원은
-- DB 기본값이 채운다. 그래서 Entity 는 읽기 전용(insertable=false)으로만 매핑한다(CONTRACT.md §5-3 ③ —
-- INSERT 에 실리면 기본값이 발동하지 않는다).
--
-- 넓히기만 한다: 기본값이 있어 이 칸을 모르는 옛 서버의 INSERT 도 그대로 통과한다.
-- 기존 행은 언제 마지막으로 로그인했는지 알 수 없어 만든 시각으로 채운다.
ALTER TABLE public.user_identities
    ADD COLUMN last_used_at timestamp with time zone;

UPDATE public.user_identities SET last_used_at = created_at;

ALTER TABLE public.user_identities
    ALTER COLUMN last_used_at SET DEFAULT now(),
    ALTER COLUMN last_used_at SET NOT NULL;
