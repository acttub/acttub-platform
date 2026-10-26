-- account_cleanup_operations.kind — RevenueCat 고객 삭제(SOMA-818, account.withdraw).
--
-- 탈퇴하면 RevenueCat 에 있는 이 사람의 고객 정보(app_user_id = 우리 user id, 구매 기록·스토어 거래 ID)도 지운다
-- (RevenueCat REST v1 DELETE /v1/subscribers/{app_user_id}). 탈퇴 트랜잭션이 장부에 올리고, 바깥 호출은 커밋 뒤
-- 장부의 실행기(AccountCleanup)가 한다 — 실패하면 다른 제공자 해제처럼 5분부터 두 배씩 다시 시도하고 7일 뒤 포기하며
-- 운영자에게 알린다. RevenueCat 이 꺼진 서버(BILLING_REVENUECAT_ENABLED=false 이거나 비밀 키 없음)는 이 값을 올리지 않는다.
--
-- 값을 더하기만 한다. 옛 서버는 이 값을 쓰지 않고, 장부 실행기는 모르는 종류를 실패로 남긴다(옛 서버로 되돌린 동안
-- 올라온 행이 없으므로 실제로는 생기지 않는다).
ALTER TABLE public.account_cleanup_operations
    DROP CONSTRAINT ck_account_cleanup_operations_kind;
ALTER TABLE public.account_cleanup_operations
    ADD CONSTRAINT ck_account_cleanup_operations_kind
        CHECK ((kind = ANY (ARRAY['object_delete'::text, 'apple_revoke'::text, 'kakao_unlink'::text,
                                  'naver_revoke'::text, 'reading_recording_delete'::text,
                                  'revenuecat_delete'::text])));
