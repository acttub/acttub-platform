package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code user_airbridge_device_lookups}(V43, SOMA-643) — 앱이 넘긴 Airbridge 기기 ID 를 유입 출처를 다시 물을 때까지 두는 줄.
 * 계정마다 한 줄이고, 귀속을 받거나 24시간이 지나면 지운다. 기기 ID 는 이 표에만 있다.
 *
 * <p>넣기는 HQL {@code insert … select … on conflict (userId) do nothing}({@code PostgresProfileRepository}), 재조회의 읽기·
 * 미루기·지우기는 HQL 이다({@code PostgresAirbridgeLookupStore}).
 */
@Entity
@Table(name = "user_airbridge_device_lookups")
public class UserAirbridgeDeviceLookupEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "platform", nullable = false)
    private String platform;

    @Column(name = "device_uuid", nullable = false)
    private String deviceUuid;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    protected UserAirbridgeDeviceLookupEntity() {
    }
}
