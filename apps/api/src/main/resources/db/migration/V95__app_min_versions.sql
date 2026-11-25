-- 스토어를 보고 서버가 스스로 올리는 플랫폼별 최소 앱 판(SOMA-1150). MIN_VERSION_AUTO_RAISE=true 일 때만 쓴다.
-- 플랫폼(ios·android)마다 한 줄이다. minimum 은 서버가 올린 최소 판(없으면 NULL — 환경변수 MIN_APP_VERSION_* 만 쓴다),
-- store_version 은 마지막으로 본 스토어 판, store_live_since 는 그 판을 처음 본 시각이다.
-- 급히 되돌리기: UPDATE app_min_versions SET minimum=NULL, updated_at=now() WHERE platform='ios';  (1분 안에 반영)
--
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.app_min_versions (
    platform text NOT NULL PRIMARY KEY,
    minimum text,
    store_version text,
    store_live_since timestamp with time zone,
    raised_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
