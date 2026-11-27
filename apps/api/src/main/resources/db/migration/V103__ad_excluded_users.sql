-- 광고마다 보이지 않을 계정을 지정한다 (SOMA-1069).
--
-- 예: 학생 연극 직접 광고를 그 연극 팀원 계정에는 띄우지 않는다. 고르는 쪽(AdPicker)이 이 목록에 든 사람에게는 이 광고가
-- 없는 것처럼 다음 단계(우리 앱 광고·AdMob)로 넘어간다. 값은 지금은 운영자가 SQL 로만 넣는다 — 운영 화면 등록·수정은 이 열을
-- 쓰지 않아 기본값 '{}' 이 남고, 수정해도 지워지지 않는다.
--
-- 직전 판 API 는 이 열을 모르고, 기본값이 있어 그 판의 INSERT 도 그대로 성공한다. 상수 기본값이라 행을 다시 쓰지 않는다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ads ADD COLUMN excluded_user_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ads.excluded_user_ids IS '이 광고를 보이지 않을 사용자 id 목록. 운영자가 SQL 로 넣는다 (SOMA-1069)';
