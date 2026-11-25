-- 동의 문서의 종류에 영상 데이터 제3자 제공(data_sharing)을 더한다 (SOMA-1149, account.consent 「데이터」).
--
-- 연기 영상과 리딩 녹음을 AI 기업·연구기관에 제공(판매 포함)하는 것은 동의한 회원에게만 한다. 그래서 선택 문서로 두고,
-- 진입에서 묻는다(ConsentDocument.askedAtEntry). 문서는 배포 파일로 발행한다.
-- 넓히기만 하므로 옛 서버의 값은 그대로 통한다(PracticeRollbackCompatibilityTest).
ALTER TABLE public.consent_documents DROP CONSTRAINT ck_consent_documents_type;
ALTER TABLE public.consent_documents ADD CONSTRAINT ck_consent_documents_type
    CHECK ((type = ANY (ARRAY['terms'::text, 'privacy'::text, 'ai_analysis'::text, 'retention'::text,
                              'data_sharing'::text, 'cloud_voice'::text, 'script_split'::text,
                              'marketing_email'::text, 'marketing_push'::text])));
