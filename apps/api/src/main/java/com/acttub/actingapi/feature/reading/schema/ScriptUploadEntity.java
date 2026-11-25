package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code script_uploads}(V34) — 올린 대본 원본 파일 하나 (reading.script 「원본 파일」).
 *
 * <p>글자를 뽑으면 {@code raw_text} 가, 그 글로 대본이 저장되면 {@code script_id} 가 차고 {@code raw_text} 는 비운다. 읽거나
 * 나누지 못하면 {@code failure} 를 남기고 동의가 있으면 {@code kept_until} 까지 둔다(V39). {@code failure} 는 DB 값이자 API
 * 값이라 문자열 그대로 둔다.
 */
@Entity
@Table(name = "script_uploads")
public class ScriptUploadEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "file_name")
    private String fileName;

    @Column(name = "byte_size", nullable = false)
    private long byteSize;

    @Column(name = "raw_text")
    private String rawText;

    @Column(name = "script_id")
    private UUID scriptId;

    @Column(name = "failure")
    private String failure;

    @Column(name = "kept_until")
    private Instant keptUntil;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ScriptUploadEntity() {
    }

    public ScriptUploadEntity(UUID id, UUID userId, String objectKey, String fileName, long byteSize, Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.objectKey = objectKey;
        this.fileName = fileName;
        this.byteSize = byteSize;
        this.expiresAt = expiresAt;
    }
}
