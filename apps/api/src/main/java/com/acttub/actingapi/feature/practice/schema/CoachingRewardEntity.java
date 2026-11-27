package com.acttub.actingapi.feature.practice.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code coaching_rewards}(V103, SOMA-1067) — 보상형 광고로 받은 무료 코칭 1회. AdMob 서버 측 확인 콜백 하나가 한 줄이고
 * {@code transaction_id} 가 PK 라 같은 콜백이 다시 와도 한 번만 지급한다.
 *
 * <p>넣기는 native {@code INSERT … ON CONFLICT DO NOTHING}(CONTRACT §5-2)이고, 세기·확인·탈퇴 파기는 HQL 이다.
 */
@Entity
@Table(name = "coaching_rewards")
public class CoachingRewardEntity {

    @Id
    @Column(name = "transaction_id", nullable = false)
    private String transactionId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected CoachingRewardEntity() {
    }
}
