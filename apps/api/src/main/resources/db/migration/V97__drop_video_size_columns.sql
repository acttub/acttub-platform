-- 값을 쓰는 코드가 없는 영상 크기 칸 둘을 지운다 (SOMA-1142).
--
-- videos.width·height 는 V14 가 만든 뒤 값을 쓴 코드가 없다(2026-11-25 운영 3,673행 모두 NULL). 직전 운영 API 는 VideoEntity 에서
-- 두 칸의 매핑을 내린 코드다 — 매핑이 남은 API 가 이 마이그레이션 위에서 다시 뜨면 ddl-auto: validate 가 기동을 막으므로, 그
-- 코드가 운영에 나간 다음 릴리스에 넣는다.
--
-- 잠금: 표를 다시 쓰지 않고 카탈로그만 고친다(운영 행 수로 채운 PostgreSQL 18 에서 0.5ms). videos 에 ACCESS EXCLUSIVE 를 잠깐
-- 잡는다. 기다림이 5초를 넘으면 실패시킨다 — 새 API 가 뜨지 않고 옛 API 가 그대로 돌며, 다시 배포하면 된다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.videos DROP COLUMN width, DROP COLUMN height;
