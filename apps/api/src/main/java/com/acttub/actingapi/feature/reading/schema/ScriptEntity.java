package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.ScriptSource;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code scripts} — 배우가 등록한 대본 한 편 (reading.script, ADR-031).
 *
 * <p>원문은 뒤에 파서가 나아졌을 때 다시 나누기 위해 둔다. {@code request_id} 는 기기가 만든 요청 id 로
 * (user_id, request_id) 가 유일하고, 이관 충돌 때만 NULL 이 된다. {@code request_fingerprint} 는 생성 요청의
 * 지문이라 제목·배역 이름을 고쳐도 바뀌지 않는다.
 */
@Entity
@Table(name = "scripts")
public class ScriptEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "raw_text", nullable = false)
    private String rawText;

    @Convert(converter = ScriptSource.JpaConverter.class)
    @Column(name = "source", nullable = false, columnDefinition = "text")
    private ScriptSource source;

    @Column(name = "request_id")
    private UUID requestId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", nullable = false, columnDefinition = "char(64)")
    private String requestFingerprint;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ScriptEntity() {
    }

    public ScriptEntity(
            UUID id, UUID userId, String title, String rawText, ScriptSource source, UUID requestId,
            String requestFingerprint) {
        super(id);
        this.userId = userId;
        this.title = title;
        this.rawText = rawText;
        this.source = source;
        this.requestId = requestId;
        this.requestFingerprint = requestFingerprint;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getTitle() {
        return title;
    }

    public String getRawText() {
        return rawText;
    }

    public ScriptSource getSource() {
        return source;
    }

    public UUID getRequestId() {
        return requestId;
    }

    public String getRequestFingerprint() {
        return requestFingerprint;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
