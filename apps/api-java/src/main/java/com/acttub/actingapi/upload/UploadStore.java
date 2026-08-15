package com.acttub.actingapi.upload;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.schema.UploadStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class UploadStore {
    private final JdbcTemplate jdbc;

    UploadStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    UploadIntentRow create(
            UUID userId,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Integer durationMs,
            Instant expiresAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(
                    id,user_id,status,storage_provider,object_key,mime_type,
                    size_bytes,duration_ms,expires_at)
                VALUES (?,?,'pending'::upload_status_t,'s3',?,?,?,?,?)
                """,
                id,
                userId,
                objectKey,
                mimeType,
                sizeBytes,
                durationMs,
                expiresAt.atOffset(ZoneOffset.UTC));
        return find(userId, id);
    }

    UploadIntentRow find(UUID userId, UUID intentId) {
        List<UploadIntentRow> rows = jdbc.query("""
                SELECT id,user_id,status::text,storage_provider,object_key,mime_type,
                       size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                FROM upload_intents
                WHERE id=? AND user_id=?
                """, UploadStore::intent, intentId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    UploadIntentRow finalizeIntent(
            UUID userId,
            UUID intentId,
            String etag,
            Instant now) {
        List<UploadIntentRow> rows = jdbc.query("""
                UPDATE upload_intents
                SET status='finalized'::upload_status_t,finalized_at=?,etag=?
                WHERE id=? AND user_id=?
                  AND status='pending'::upload_status_t
                  AND expires_at>?
                RETURNING id,user_id,status::text,storage_provider,object_key,mime_type,
                          size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                """,
                UploadStore::intent,
                now.atOffset(ZoneOffset.UTC),
                etag,
                intentId,
                userId,
                now.atOffset(ZoneOffset.UTC));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private static UploadIntentRow intent(ResultSet result, int rowNumber) throws SQLException {
        OffsetDateTime finalized = result.getObject("finalized_at", OffsetDateTime.class);
        return new UploadIntentRow(
                result.getObject("id", UUID.class),
                result.getObject("user_id", UUID.class),
                UploadStatus.valueOf(result.getString("status").toUpperCase(Locale.ROOT)),
                result.getString("storage_provider"),
                result.getString("object_key"),
                result.getString("mime_type"),
                result.getLong("size_bytes"),
                result.getObject("duration_ms", Integer.class),
                result.getString("etag"),
                result.getObject("created_at", OffsetDateTime.class).toInstant(),
                result.getObject("expires_at", OffsetDateTime.class).toInstant(),
                finalized == null ? null : finalized.toInstant());
    }

    record UploadIntentRow(
            UUID id,
            UUID userId,
            UploadStatus status,
            String storageProvider,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Integer durationMs,
            String etag,
            Instant createdAt,
            Instant expiresAt,
            Instant finalizedAt) {
    }
}
