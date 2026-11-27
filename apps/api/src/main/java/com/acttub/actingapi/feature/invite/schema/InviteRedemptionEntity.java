package com.acttub.actingapi.feature.invite.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code invite_redemptions}(V104, SOMA-865) — 초대받은 사람이 코드를 넣은 기록. 사람당 한 줄이다. {@code rewarded_at} 은 첫 연습을
 * 끝내 Pro 1개월이 지급된 시각(지급의 멱등 키), {@code inviter_rewarded} 는 그때 초대한 사람도 받았는지다.
 *
 * <p>넣기({@code ON CONFLICT DO NOTHING})와 지급 시각 채우기({@code UPDATE … RETURNING})는 native 이고(CONTRACT §5-2), 읽기·
 * 초대한 사람 표시·탈퇴 파기는 HQL 이다.
 */
@Entity
@Table(name = "invite_redemptions")
public class InviteRedemptionEntity {

    @Id
    @Column(name = "invitee_id", nullable = false)
    private UUID inviteeId;

    @Column(name = "inviter_id")
    private UUID inviterId;

    @Column(name = "code", nullable = false)
    private String code;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "rewarded_at")
    private Instant rewardedAt;

    @Column(name = "inviter_rewarded", nullable = false)
    private boolean inviterRewarded;

    protected InviteRedemptionEntity() {
    }
}
