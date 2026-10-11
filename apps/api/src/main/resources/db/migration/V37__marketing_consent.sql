-- 동의 문서의 종류에 광고성 정보 수신 동의 둘을 더한다 (SOMA-642, account.consent 「데이터」).
--
-- 정보통신망법 제50조는 영리 목적의 광고성 정보(뉴스레터·이벤트·챌린지 소개 푸시)를 보내기 전에 받는 사람의 명시적
-- 사전 동의를 요구하고, KISA 안내서(2026.03 개정본)는 전송 매체마다 따로 동의받도록 안내한다. 그래서 이메일
-- (marketing_email)과 앱 푸시(marketing_push)를 각각 선택 문서로 둔다. 문서는 배포 파일로 발행한다.
-- 넓히기만 하므로 옛 서버의 값은 그대로 통한다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.consent_documents DROP CONSTRAINT ck_consent_documents_type;
ALTER TABLE public.consent_documents ADD CONSTRAINT ck_consent_documents_type
    CHECK ((type = ANY (ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text,
                              'cloud_voice'::text, 'script_split'::text,
                              'marketing_email'::text, 'marketing_push'::text])));
