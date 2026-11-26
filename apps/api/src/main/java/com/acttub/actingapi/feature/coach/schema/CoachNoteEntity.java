package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code coach_notes}(V14) — 대화가 닫히며 만드는 연습 노트. 대화에 하나다({@code uq_coach_notes_conversation}). 형식과 종류는 DB
 * 값 그대로 문자열이고 허용 값은 CHECK 가 지킨다. jsonb 칸은 통째로 읽고 쓰는 JSON 글이다 — 저장소가 직렬화한 글을 그대로
 * 넘긴다. 원문 보고서가 없으면 SQL NULL 이 아니라 JSON null(글자 {@code null})을 넣는다.
 */
@Entity
@Table(name = "coach_notes")
public class CoachNoteEntity extends AppGeneratedUuidEntity {

    @Column(name = "conversation_id", nullable = false)
    UUID conversationId;

    @Column(name = "format", nullable = false)
    String format;

    @Column(name = "kind", nullable = false)
    String kind;

    @Column(name = "title")
    String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "summary_quotes", nullable = false, columnDefinition = "jsonb")
    String summaryQuotes;

    @Column(name = "next_take")
    String nextTake;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "actor_words", nullable = false, columnDefinition = "jsonb")
    String actorWords;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "corrections", nullable = false, columnDefinition = "jsonb")
    String corrections;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", nullable = false, columnDefinition = "jsonb")
    String tags;

    @Column(name = "fallback", nullable = false)
    boolean fallback;

    @Column(name = "source_revision", nullable = false)
    int sourceRevision;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "legacy_report", columnDefinition = "jsonb")
    String legacyReport;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "line_notes", nullable = false, columnDefinition = "jsonb")
    String lineNotes;

    protected CoachNoteEntity() {
    }

    /** 인용·배우 말·정정·태그·대사별 메모가 빈 노트. */
    public CoachNoteEntity(UUID id, UUID conversationId, String format, String kind, int sourceRevision, Instant now) {
        super(id);
        this.conversationId = conversationId;
        this.format = format;
        this.kind = kind;
        this.summaryQuotes = "[]";
        this.actorWords = "[]";
        this.corrections = "[]";
        this.tags = "[]";
        this.sourceRevision = sourceRevision;
        this.createdAt = now;
        this.lineNotes = "[]";
    }
}
