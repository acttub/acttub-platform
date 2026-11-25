package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code script_cocreations}(V56) — 찍을 대사 같이 만들기의 생성 요청 하나 (SOMA-721).
 *
 * <p>(user_id, request_id) 가 유일하다. {@code versions} 가 비어 있으면 아직 만드는 중이다. 조건과 버전은 JSON 글을 text 칸에
 * 그대로 둔다(모양은 서비스가 정한다). {@code busy_since} 는 수정이 도는 중이라는 표시이고, 확정하면 {@code script_id} 가 찬다.
 */
@Entity
@Table(name = "script_cocreations")
public class ScriptCocreationEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "conditions")
    private String conditions;

    @Column(name = "versions")
    private String versions;

    @Column(name = "current_version", nullable = false)
    private int currentVersion;

    @Column(name = "revisions_used", nullable = false)
    private int revisionsUsed;

    @Column(name = "model")
    private String model;

    @Column(name = "busy_since")
    private Instant busySince;

    @Column(name = "script_id")
    private UUID scriptId;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ScriptCocreationEntity() {
    }

    public ScriptCocreationEntity(UUID id, UUID userId, UUID requestId) {
        super(id);
        this.userId = userId;
        this.requestId = requestId;
    }

    public UUID getRequestId() {
        return requestId;
    }

    public String getConditions() {
        return conditions;
    }

    public String getVersions() {
        return versions;
    }

    public int getCurrentVersion() {
        return currentVersion;
    }

    public int getRevisionsUsed() {
        return revisionsUsed;
    }

    public String getModel() {
        return model;
    }

    public Instant getBusySince() {
        return busySince;
    }

    public UUID getScriptId() {
        return scriptId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
