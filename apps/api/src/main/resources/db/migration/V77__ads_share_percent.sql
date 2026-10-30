-- 우리 앱 광고(house)의 노출 비율(SOMA-876). 칸을 열 때 서버가 고른 house 광고가 이 비율(0~100 %)의 확률로 그대로 나가고,
-- 나머지는 AdMob(NETWORK)으로 채운다. 직접 광고(direct)는 비율 없이 늘 먼저 나가므로 이 값을 쓰지 않는다(저장값은 기본 50 그대로).
-- 이미 있는 광고 줄도 기본값 50 으로 채워진다(의도). 더하기만 하는 변경이다: 옛 서버는 이 열을 모르고 읽지도 쓰지도 않는다.
ALTER TABLE ads ADD COLUMN share_percent integer DEFAULT 50 NOT NULL;
