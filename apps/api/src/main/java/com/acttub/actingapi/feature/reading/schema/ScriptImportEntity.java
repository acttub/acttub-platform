package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code script_imports}(V33) — 대본 나누기 요청 하나 (reading.script 「대본 나누기」).
 *
 * <p>(user_id, request_id) 가 유일하다. 끝나면 {@code script_id} 나 {@code failure} 가운데 하나만 차고 {@code raw_text} 는
 * 비운다. {@code job_id} 는 뒤에서 도는 나누기 작업(`ai_jobs`)이고 서버가 바로 대본을 만든 요청(예시·다시 쓰기)은 비어 있다.
 * {@code source}·{@code failure} 는 DB 값이자 API 값이라 문자열 그대로 둔다(허용 값은 DB 의 CHECK 가 지킨다).
 */
@Entity
@Table(name = "script_imports")
public class ScriptImportEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", nullable = false, columnDefinition = "char(64)")
    private String requestFingerprint;

    @Column(name = "title")
    private String title;

    @Column(name = "source", nullable = false)
    private String source;

    @Column(name = "raw_text", nullable = false)
    private String rawText;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "raw_hash", nullable = false, columnDefinition = "char(64)")
    private String rawHash;

    @Column(name = "job_id")
    private UUID jobId;

    @Column(name = "script_id")
    private UUID scriptId;

    @Column(name = "failure")
    private String failure;

    @Column(name = "skip_script_check", nullable = false)
    private boolean skipScriptCheck;

    @Column(name = "upload_id")
    private UUID uploadId;

    @Column(name = "done_lines", nullable = false)
    private int doneLines;

    @Column(name = "total_lines", nullable = false)
    private int totalLines;

    @Column(name = "progress_percent", nullable = false)
    private int progressPercent;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ScriptImportEntity() {
    }

    public ScriptImportEntity(
            UUID id, UUID userId, UUID requestId, String requestFingerprint, String title, String source, String rawText,
            String rawHash) {
        super(id);
        this.userId = userId;
        this.requestId = requestId;
        this.requestFingerprint = requestFingerprint;
        this.title = title;
        this.source = source;
        this.rawText = rawText;
        this.rawHash = rawHash;
    }
}
