-- 회차를 만든 사람의 말을 기억한다 (coach 「첫 질문 미리 쓰기」, SOMA-946).
--
-- 분석이 끝나면 서버가 첫 질문을 미리 쓴다(SOMA-780). 그 자리엔 요청이 없어서 배우가 어느 말을 쓰는지
-- 알 길이 없고, 그대로 두면 영어 기기로 연습을 만든 배우에게도 한국어 첫 질문이 저장된다(운영 11/2 확인).
--
-- 앱이 회차를 만들 때는 요청이므로 그때 말(Accept-Language)을 함께 저장해 둔다. 미리 쓸 때 그 값을 읽는다.
-- 더하기만 하는 변경이다. NULL 허용이라 직전 판 API 의 INSERT 도 그대로 통하고, NULL 인 회차는 미리 쓰지 않는다.
ALTER TABLE practices
    ADD COLUMN IF NOT EXISTS language text;
