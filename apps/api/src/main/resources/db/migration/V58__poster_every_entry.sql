-- 공지 팝업을 앱에 들어올 때마다 보이는 빈도(every)를 더한다(SOMA-799). 넓히기만 한다 — 옛 값 daily·once 는 그대로다.
ALTER TABLE app_posters DROP CONSTRAINT ck_app_posters_frequency;
ALTER TABLE app_posters ADD CONSTRAINT ck_app_posters_frequency CHECK (frequency IN ('daily', 'once', 'every'));
