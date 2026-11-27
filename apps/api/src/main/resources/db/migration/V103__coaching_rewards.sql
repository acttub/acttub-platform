-- 보상형 광고로 받은 무료 코칭 1회(SOMA-1067). AdMob 서버 측 확인(SSV) 콜백 하나가 한 줄이다.
-- transaction_id(AdMob 이 광고 시청마다 주는 값)가 PK 라 같은 콜백이 다시 와도 한 번만 지급한다.
-- request_id 는 앱이 광고를 띄울 때 만든 1회용 id(custom_data)이고, 앱이 지급 여부를 이 값으로 묻는다.
-- 더하기만 하는 표라 옛 서버와 함께 돌아도 영향이 없다. Schema Entity 없이 native SQL 로만 읽고 쓴다.
CREATE TABLE coaching_rewards (
    transaction_id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_coaching_rewards_request ON coaching_rewards (user_id, request_id);
