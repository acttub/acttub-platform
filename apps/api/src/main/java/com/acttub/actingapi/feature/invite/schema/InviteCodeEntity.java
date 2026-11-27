package com.acttub.actingapi.feature.invite.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code invite_codes}(V104, SOMA-865) — 회원 한 명에 초대 코드 하나. 처음 내 코드를 열 때 서버가 만든다.
 *
 * <p>붙이기는 native {@code INSERT … ON CONFLICT DO NOTHING RETURNING}(CONTRACT §5-2)이고, 읽기와 탈퇴 파기는 HQL 이다.
 */
@Entity
@Table(name = "invite_codes")
public class InviteCodeEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "code", nullable = false)
    private String code;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected InviteCodeEntity() {
    }
}
