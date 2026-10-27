-- 창립 멤버(SOMA-861). 실제 유료 결제(스토어 RevenueCat·웹 토스)로 Pro 를 처음 연 사용자 100명에게 1~100 번호를 한 번만 준다.
-- 무료 지급(billing_pro_grants)·샌드박스 구매는 세지 않는다. 해지·재가입해도 번호는 그대로다.
-- number: 1~100 한 줄에 한 번호(PK + CHECK). user_id: 사람당 한 번호(UNIQUE). 탈퇴해 사람이 지워져도 번호는 비우지 않는다
--   (ON DELETE SET NULL — 자리가 다시 열려 101번째가 생기지 않게). 상한은 번호 범위 CHECK 가 DB 에서 막고,
--   동시 부여는 서버가 트랜잭션 advisory lock 으로 줄 세운다. 더하기만 하는 변경이고 옛 서버는 이 표를 모른다.
CREATE TABLE public.founding_members (
    number integer NOT NULL PRIMARY KEY,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    provider text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_founding_members_number CHECK (number BETWEEN 1 AND 100),
    CONSTRAINT uq_founding_members_user UNIQUE (user_id)
);
