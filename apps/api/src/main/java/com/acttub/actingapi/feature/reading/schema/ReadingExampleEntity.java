package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code reading_examples}(V61) — 서버에 미리 나눠 둔 예시 대본 한 편 (reading.script 「예시 대본」).
 *
 * <p>행은 마이그레이션과 운영 SQL 이 넣고 앱은 읽기만 한다. PK 는 사람이 지은 글자 id 다. {@code draft}(배역과 줄)와
 * {@code audio}(미리 만든 음성, V62)는 jsonb 를 글 그대로 읽어 저장소가 푼다 — 깨진 {@code audio} 를 음성 없는 예시로 다루려면
 * 읽는 쪽이 모양을 판정해야 한다.
 */
@Entity
@Table(name = "reading_examples")
public class ReadingExampleEntity {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "summary", nullable = false)
    private String summary;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "active", nullable = false)
    private boolean active;

    @Column(name = "language", nullable = false)
    private String language;

    @Column(name = "raw_text", nullable = false)
    private String rawText;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "draft", nullable = false, columnDefinition = "jsonb")
    private String draft;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "audio", columnDefinition = "jsonb")
    private String audio;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ReadingExampleEntity() {
    }

    public String getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public String getSummary() {
        return summary;
    }

    public String getRawText() {
        return rawText;
    }

    public String getDraft() {
        return draft;
    }

    public String getAudio() {
        return audio;
    }
}
