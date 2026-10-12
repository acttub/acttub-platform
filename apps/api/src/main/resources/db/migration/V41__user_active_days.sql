-- 회원이 서비스에 들어온 날(한국 날짜) 한 줄씩. ops 리텐션(가입·첫 접속 코호트가 며칠·몇 주 뒤에도 들어왔나)의 원장이다.
--
-- 쓰는 곳: 로그인·가입·게스트가 리프레시 토큰을 받을 때와, 앱·웹이 토큰을 갱신할 때
-- (PostgresAuthRepository#issueRefresh·#rotate). 액세스 토큰이 30분이라 쓰는 동안은 30분마다,
-- 쉬었다 다시 열면 첫 요청에서 갱신이 일어난다 — 그날 들어왔는지를 알기에 충분하다.
-- 지우는 곳: 탈퇴(그리고 같은 절차를 밟는 게스트 파기)와 게스트 옮기기. 처리방침의 "탈퇴 후 남기는 것"에 없으므로 남기지 않는다.
--
-- 과거 채우기: refresh_tokens 는 만료·폐기 30일 뒤 매일 지워져(account.login) 그 전의 날은 알 수 없다.
-- 남아 있는 토큰의 발급일로 최근 약 30일만 채운다. 탈퇴한 계정은 채우지 않는다.
CREATE TABLE public.user_active_days (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    day date NOT NULL,
    PRIMARY KEY (user_id, day)
);

INSERT INTO public.user_active_days (user_id, day)
SELECT DISTINCT rt.user_id, (rt.issued_at AT TIME ZONE 'Asia/Seoul')::date
FROM public.refresh_tokens rt
JOIN public.users u ON u.id = rt.user_id
WHERE u.deactivated_at IS NULL
ON CONFLICT DO NOTHING;
