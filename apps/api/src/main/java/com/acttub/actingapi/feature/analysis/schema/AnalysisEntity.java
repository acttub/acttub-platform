package com.acttub.actingapi.feature.analysis.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

/**
 * {@code analyses}(V14) — 0.1.0 회차 하나의 분석 기록. 회차마다 하나({@code uq_analyses_practice})이고 완료 뒤 불변이다.
 *
 * <p>{@code format}·{@code status} 는 DB 값 그대로 문자열이다. 허용 값은 DB 의 CHECK 가 지킨다. {@code record} 는 관찰 묶음의
 * JSON 이고, 관찰 묶음이 없으면 SQL NULL 이 아니라 JSON null 이다.
 */
@Entity
@Table(name = "analyses")
public class AnalysisEntity extends AppGeneratedUuidEntity {

    @Column(name = "practice_id", nullable = false)
    private UUID practiceId;

    @Column(name = "format", nullable = false)
    private String format;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "model", nullable = false)
    private String model;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "record", nullable = false, columnDefinition = "jsonb")
    private JsonNode record;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "completed_at", nullable = false)
    private Instant completedAt;

    protected AnalysisEntity() {
    }

    public AnalysisEntity(UUID id, UUID practiceId, String format, String status, String model, JsonNode record,
            Instant createdAt, Instant completedAt) {
        super(id);
        this.practiceId = practiceId;
        this.format = format;
        this.status = status;
        this.model = model;
        this.record = record;
        this.createdAt = createdAt;
        this.completedAt = completedAt;
    }
}
