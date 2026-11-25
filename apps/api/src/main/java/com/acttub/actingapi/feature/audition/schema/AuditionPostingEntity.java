package com.acttub.actingapi.feature.audition.schema;

import java.time.Instant;
import java.time.LocalDate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code audition_postings}(V36) — 공개 출처에서 모은 오디션 공고의 사실 항목.
 *
 * <p>{@code (source, source_ref)} 가 한 공고이고 저장소는 그 둘을 대상으로 한 HQL upsert 로만 넣고 고친다. PK 는 DB 가 매기는
 * {@code bigint} identity({@code GENERATED ALWAYS})라 넣는 문장에 싣지 않는다. 출처·분야 값은 DB 의 CHECK 와
 * {@code AuditionRules} 가 지킨다.
 */
@Entity
@Table(name = "audition_postings")
public class AuditionPostingEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "source", nullable = false)
    private String source;

    @Column(name = "source_ref", nullable = false)
    private String sourceRef;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "category", nullable = false)
    private String category;

    @Column(name = "pay_text")
    private String payText;

    @Column(name = "apply_start")
    private LocalDate applyStart;

    @Column(name = "apply_end")
    private LocalDate applyEnd;

    @Column(name = "status_text")
    private String statusText;

    @Column(name = "posted_on", nullable = false)
    private LocalDate postedOn;

    @Column(name = "source_url", nullable = false)
    private String sourceUrl;

    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    protected AuditionPostingEntity() {
    }

    public Long getId() {
        return id;
    }
}
