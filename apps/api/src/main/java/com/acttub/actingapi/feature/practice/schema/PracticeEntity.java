package com.acttub.actingapi.feature.practice.schema;

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
 * {@code practices}(V14) — 0.1.0 연습 회차. 같은 {@code root_id} 가 한 묶음이고 묶음 속성(제목·태그·즐겨찾기·숨김)은 첫 행에
 * 있다. 단계·닫힌 까닭·세션 목적은 DB 값 그대로 문자열이고 허용 값은 CHECK 가 지킨다. 회차를 화면에 싣는 조회는 영상·분석·대화·
 * 작업을 함께 보는 native 문장이다.
 */
@Entity
@Table(name = "practices")
public class PracticeEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "video_id")
    UUID videoId;

    @Column(name = "root_id", nullable = false)
    UUID rootId;

    @Column(name = "ordinal", nullable = false)
    int ordinal;

    @Column(name = "stage", nullable = false)
    String stage;

    @Column(name = "close_reason")
    String closeReason;

    @Column(name = "experience_version", nullable = false)
    String experienceVersion;

    @Column(name = "request_id")
    UUID requestId;

    // bpchar 이라 JdbcTypeCode 를 함께 준다(RefreshTokenEntity 와 같다).
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", columnDefinition = "char(64)")
    String requestFingerprint;

    @Column(name = "situation", nullable = false)
    String situation;

    @Column(name = "character_context", nullable = false)
    String characterContext;

    @Column(name = "goal", nullable = false)
    String goal;

    @Column(name = "blockage_kind", nullable = false)
    String blockageKind;

    @Column(name = "sub_branch", nullable = false)
    String subBranch;

    @Column(name = "blockage_detail")
    String blockageDetail;

    @Column(name = "title")
    String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", nullable = false, insertable = false, columnDefinition = "jsonb")
    JsonNode tags;

    @Column(name = "favorite", nullable = false)
    boolean favorite;

    @Column(name = "hidden_at")
    Instant hiddenAt;

    @Column(name = "legacy_hidden_at")
    Instant legacyHiddenAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    Instant updatedAt;

    @Column(name = "session_purpose")
    String sessionPurpose;

    @Column(name = "face_mosaic", nullable = false)
    boolean faceMosaic;

    @Column(name = "reading_session_id")
    UUID readingSessionId;

    @Column(name = "language")
    String language;

    protected PracticeEntity() {
    }

    /** 첫 회차(제 묶음의 뿌리). */
    public PracticeEntity(UUID id, UUID userId, String stage, String experienceVersion, String blockageKind, String subBranch,
            Instant now) {
        super(id);
        this.userId = userId;
        this.rootId = id;
        this.ordinal = 1;
        this.stage = stage;
        this.experienceVersion = experienceVersion;
        this.situation = "";
        this.characterContext = "";
        this.goal = "";
        this.blockageKind = blockageKind;
        this.subBranch = subBranch;
        this.createdAt = now;
        this.updatedAt = now;
    }
}
