package com.acttub.actingapi.feature.feedback.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code practice_feedback}(V14) — 이탈 설문 한 건과 그 시트 복제의 순번.
 *
 * <p>화면·계기 칸은 DB 값이자 API 값이라 문자열 그대로 둔다. 허용 값은 DB 의 CHECK 와 {@code ExitSurveyRules} 가 지키고,
 * {@code FeedbackScreen}·{@code FeedbackTrigger} 가 CHECK 와 같은지는 {@code ValueCheckCatalogIT} 가 본다. 접수는 활성 계정만
 * 고르는 native {@code INSERT … SELECT} 이고, 나머지 읽기와 고치기가 이 매핑을 쓴다.
 */
@Entity
@Table(name = "practice_feedback")
public class PracticeFeedbackEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "practice_id")
    private UUID practiceId;

    @Column(name = "screen", nullable = false)
    private String screen;

    @Column(name = "trigger", nullable = false)
    private String trigger;

    @Column(name = "body")
    private String body;

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "contact_phone")
    private String contactPhone;

    @Column(name = "request_id")
    private UUID requestId;

    @Column(name = "sheet_seq", nullable = false)
    private int sheetSeq;

    @Column(name = "sheet_synced_at")
    private Instant sheetSyncedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected PracticeFeedbackEntity() {
    }

    public PracticeFeedbackEntity(UUID id, UUID userId, String screen, String trigger, UUID requestId, Instant createdAt) {
        super(id);
        this.userId = userId;
        this.screen = screen;
        this.trigger = trigger;
        this.requestId = requestId;
        this.sheetSeq = 1;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }
}
