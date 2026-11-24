-- 쓰지 않는 상태 값 둘을 CHECK 에서 뺀다 (SOMA-1130).
--
-- user_consents.action 의 revoked: API 는 처음부터 받지 않았다(입력은 granted·declined). 탈퇴 뒤 운영자가 처리하는 보관 동의
-- 철회만 SQL 로 revoked 를 적어 왔는데, 이제 같은 자리에 declined 를 적는다(docs/deploy/RETENTION-REVOCATION.md). 탈퇴한
-- 계정은 API 로 결정을 남기지 못하므로 탈퇴 시각 뒤의 declined 가 곧 운영자의 철회다.
-- entry_reports.resolution 의 restored: 운영 판정에서 dismissed 와 같은 길(남은 신고가 없으면 숨김을 푼다)이었다. 운영 API 가
-- 이제 kept_hidden·dismissed 만 받는다.
--
-- 행은 고치지 않는다. 2026-11-24 운영 집계에서 두 값의 행은 0 이다. 그 값의 행이 있으면 아래 ADD CONSTRAINT 가 실패해 새 API 가
-- 뜨지 않고 옛 API 가 그대로 돈다.
--
-- 되돌리기: 옛 서버는 revoked 를 쓰지 않는다. restored 는 배포 중 옛 API 가 그 판정을 받으면 이 CHECK 에 걸려 500 이다(운영
-- 판정 요청을 다시 보내면 새 API 가 422 로 답한다).
ALTER TABLE public.user_consents DROP CONSTRAINT ck_user_consents_action;
ALTER TABLE public.user_consents ADD CONSTRAINT ck_user_consents_action
    CHECK ((action = ANY (ARRAY['granted'::text, 'declined'::text])));

ALTER TABLE public.entry_reports DROP CONSTRAINT ck_entry_reports_resolution;
ALTER TABLE public.entry_reports ADD CONSTRAINT ck_entry_reports_resolution
    CHECK ((resolution = ANY (ARRAY['kept_hidden'::text, 'dismissed'::text])));
