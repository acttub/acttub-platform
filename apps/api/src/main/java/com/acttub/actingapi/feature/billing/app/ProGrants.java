package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 카드 없이 주는 Pro 기간({@code billing_pro_grants})을 다른 기능이 넣고 세는 Port (ADR-040). 표는 {@code billing} 의 것이다.
 * 지금 부르는 곳은 친구 초대 보상(SOMA-865, reason {@code friend_invite}) 하나다.
 *
 * <p><b>부르는 쪽의 트랜잭션에 참여한다</b> — 구현은 트랜잭션을 열지 않는다. 지급 시각 채우기와 기간 넣기가 한 트랜잭션이어야
 * 「한 번만, 빠짐없이」가 선다.
 */
public interface ProGrants {

    /**
     * Pro 1개월 기간을 한 줄 넣는다. 이미 받은 기간(다른 보상·운영 지급)이 {@code now} 뒤까지 남아 있으면 그 끝에 잇는다 — 겹쳐서
     * 사라지지 않게. 결제 구독은 보지도 건드리지도 않는다.
     */
    void grantMonth(UUID userId, String reason, Instant now);

    /** 이 사람이 이 사유로 받은 기간의 수. */
    int count(UUID userId, String reason);
}
