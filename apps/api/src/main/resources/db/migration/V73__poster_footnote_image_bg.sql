-- 공지 팝업에 작은 각주(footnote)와 이미지 배경색(image_bg, #RRGGBB)을 더한다(SOMA-927). 둘 다 비어 있어도 되고 옛 행은 그대로다.
ALTER TABLE app_posters ADD COLUMN footnote text NULL;
ALTER TABLE app_posters ADD COLUMN image_bg text NULL;
ALTER TABLE app_posters ADD CONSTRAINT ck_app_posters_image_bg CHECK (image_bg IS NULL OR image_bg ~ '^#[0-9A-Fa-f]{6}$');
