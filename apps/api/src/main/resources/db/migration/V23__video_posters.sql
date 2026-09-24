-- 보관함 영상의 포스터(첫 장면 JPEG, practice.library, SOMA-562). 넓히기만 한다 — 옛 서버는 두 칸을 모르고 그대로 돈다.
--
--    `poster_key` 는 영상 객체 옆에 둔 JPEG 의 키다(`videos/{사용자}/{요청}.poster.jpg`). 마무리는 기다리지 않는다 —
--    워커가 뒤에 만들고 채운다. NULL 이면 아직 없거나 만들지 못한 것이고 목록의 `poster_url` 도 NULL 이다.
--    파기(`purged_at`)된 영상은 키가 남아도 객체가 없다(`object_key` 와 같은 규칙).
--
--    `poster_attempts` 는 워커가 이 영상을 집은 횟수다. 집을 때 올리므로 도중에 죽은 시도도 센다 — 상한(3)에
--    닿으면 더 고르지 않는다. 깨진 영상 하나가 매 주기 내려받기·ffmpeg 를 반복하지 않게 한다.
ALTER TABLE public.videos ADD COLUMN poster_key text;
ALTER TABLE public.videos ADD COLUMN poster_attempts smallint DEFAULT 0 NOT NULL;
