-- 동의 문서에 말(locale)을 붙인다 (SOMA-544).
--
-- 미국에 앱을 내면서 이용약관·개인정보처리방침·AI 분석 동의를 영어로도 보여줘야 한다.
-- 지금은 한 종류(type)에 한 판(version)만 있을 수 있어 같은 판의 번역본이 들어갈 자리가 없다.
--
-- 한국어가 정본이다. 어느 판이 현행인지는 한국어 행이 정하고, 다른 말은 그 판의 번역본으로만
-- 존재한다. 번역본이 없으면 한국어를 보여준다 — 동의 화면이 비는 것보다 낫다.
--
-- 이미 있는 행은 전부 한국어다. 기본값을 'ko' 로 두어 그대로 살린다.
ALTER TABLE consent_documents
    ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'ko';

-- 같은 판의 번역본이 나란히 설 수 있어야 한다. 제약 이름은 그대로 둔다 —
-- 발행기가 동시 기동 경합을 이 이름으로 알아본다(ConsentDocumentPublisher.isUniqueRace).
ALTER TABLE consent_documents
    DROP CONSTRAINT IF EXISTS uq_consent_documents_type_version;

ALTER TABLE consent_documents
    ADD CONSTRAINT uq_consent_documents_type_version UNIQUE (type, version, locale);

-- 현행 판을 찾는 조회가 한국어 행만 훑으므로 말까지 함께 태운다.
DROP INDEX IF EXISTS idx_consent_documents_latest;
CREATE INDEX idx_consent_documents_latest
    ON consent_documents USING btree (type, locale, published_at DESC);
