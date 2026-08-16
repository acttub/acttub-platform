package com.acttub.actingapi.practice.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.schema.PgEnumJdbcType;
import com.acttub.actingapi.schema.PracticeStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcType;

/**
 * {@code practice_sessions} — 부분 인덱스
 * {@code idx_practice_sessions_user_visible_created ... WHERE hidden_at IS NULL} 가 걸려 있어
 * {@code ddl-auto: validate} 가 부분 인덱스를 어떻게 다루는지 확인하는 대상이다 (/SPEC.md §5-3-6).
 *
 * <p>{@code user_id}/{@code upload_intent_id} 는 FK 컬럼을 UUID 로만 들고 있는다 — 관계 매핑 금지.
 */
@Entity
@Table(name = "practice_sessions")
public class PracticeSessionEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "upload_intent_id", nullable = false)
    private UUID uploadIntentId;

    @Convert(converter = PracticeStatus.JpaConverter.class)
    @JdbcType(PgEnumJdbcType.class)
    @Column(name = "status", nullable = false, columnDefinition = "practice_status_t")
    private PracticeStatus status;

    @Column(name = "situation", nullable = false)
    private String situation;

    @Column(name = "character_context", nullable = false)
    private String characterContext;

    @Column(name = "subtext")
    private String subtext;

    /**
     * {@code blockage_kind}/{@code sub_branch}/{@code goal} 은 alembic {@code 0010} 이 NOT NULL 로
     * 추가했다. 게다가 앞의 둘은 {@code ck_practice_sessions_blockage_branch} CHECK 제약이 묶는
     * 조합만 허용한다 — 값을 아무거나 넣으면 INSERT 가 거부된다 (/SPEC.md §5-3-6).
     */
    @Column(name = "blockage_kind", nullable = false)
    private String blockageKind;

    @Column(name = "sub_branch", nullable = false)
    private String subBranch;

    @Column(name = "blockage_detail")
    private String blockageDetail;

    @Column(name = "goal", nullable = false)
    private String goal;

    @Column(name = "hidden_at")
    private Instant hiddenAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected PracticeSessionEntity() {
    }

    public PracticeSessionEntity(UUID id, UUID userId, UUID uploadIntentId, PracticeStatus status,
            String situation, String characterContext, String subtext,
            String blockageKind, String subBranch, String goal) {
        super(id);
        this.userId = userId;
        this.uploadIntentId = uploadIntentId;
        this.status = status;
        this.situation = situation;
        this.characterContext = characterContext;
        this.subtext = subtext;
        this.blockageKind = blockageKind;
        this.subBranch = subBranch;
        this.goal = goal;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getUploadIntentId() {
        return uploadIntentId;
    }

    public PracticeStatus getStatus() {
        return status;
    }

    public String getSituation() {
        return situation;
    }

    public String getCharacterContext() {
        return characterContext;
    }

    public String getSubtext() {
        return subtext;
    }

    public String getBlockageKind() {
        return blockageKind;
    }

    public String getSubBranch() {
        return subBranch;
    }

    public String getBlockageDetail() {
        return blockageDetail;
    }

    public String getGoal() {
        return goal;
    }

    public Instant getHiddenAt() {
        return hiddenAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
