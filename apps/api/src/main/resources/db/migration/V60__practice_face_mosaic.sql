-- 코칭 연습의 얼굴 가리기(practice.start). 켠 회차는 분석·코치가 원본 대신 서버가 만든 얼굴 모자이크본을 본다.
-- 모자이크본을 만들 수 없으면(얼굴을 못 찾음·만들 수 없는 기동) 원본을 AI 에 보내지 않고 분석을 실패로 닫는다.
-- 원본 영상은 그대로 둔다. 모자이크본은 저장소에 남기지 않는다(분석·코치가 그때그때 만든다).
-- 더하기만 하는 변경이다: 직전 판 API 는 이 열을 모르고 넣으므로 기본값(false, 끔)이 그 상태다.
ALTER TABLE public.practices
    ADD COLUMN face_mosaic boolean DEFAULT false NOT NULL;
