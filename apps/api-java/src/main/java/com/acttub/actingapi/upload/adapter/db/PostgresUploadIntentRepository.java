package com.acttub.actingapi.upload.adapter.db;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.UploadStatus;
import com.acttub.actingapi.upload.app.UploadIntentRepository;
import com.acttub.actingapi.upload.domain.UploadIntent;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class PostgresUploadIntentRepository implements UploadIntentRepository {
    private final JdbcTemplate jdbc;

    PostgresUploadIntentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UploadIntent create(
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

    @Override
    public UploadIntent find(UUID userId, UUID intentId) {
        List<UploadIntent> rows = jdbc.query("""
                SELECT id,user_id,status::text,storage_provider,object_key,mime_type,
                       size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                FROM upload_intents
                WHERE id=? AND user_id=?
                """, PostgresUploadIntentRepository::intent, intentId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public UploadIntent finalizeIntent(
            UUID userId,
            UUID intentId,
            String etag,
            Instant now) {
        List<UploadIntent> rows = jdbc.query("""
                UPDATE upload_intents
                SET status='finalized'::upload_status_t,finalized_at=?,etag=?
                WHERE id=? AND user_id=?
                  AND status='pending'::upload_status_t
                  AND expires_at>?
                RETURNING id,user_id,status::text,storage_provider,object_key,mime_type,
                          size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                """,
                PostgresUploadIntentRepository::intent,
                now.atOffset(ZoneOffset.UTC),
                etag,
                intentId,
                userId,
                now.atOffset(ZoneOffset.UTC));
        return rows.isEmpty() ? null : rows.getFirst();
    }

    /**
     * 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다.
     *
     * <p><b>Domain Model 이 문자열을 들되 느슨해지지는 않게 하는 자리다.</b> 열거형은
     * {@code jakarta.persistence} 를 끌고 있어 {@code domain} 으로 들일 수 없지만, 그렇다고
     * 어휘 밖 값을 통과시키면 재편이 실패 경로를 넓힌다 — 스키마를 먼저 넓히고 코드를 나중에
     * 좁히는 배포 순서에서 <b>DB 에 값이 먼저, 자바가 나중</b>은 실제로 일어난다. 종전처럼
     * 여기서 터지고 500 이 난다. ({@code practice} 가 검증 없이 문자열을 쓰는 것은 그쪽이
     * 재편 전부터 그랬기 때문이고, 이 넷은 열거형이었다.)
     */
    private static String status(String raw) {
        return UploadStatus.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    private static UploadIntent intent(ResultSet result, int rowNumber) throws SQLException {
        OffsetDateTime finalized = result.getObject("finalized_at", OffsetDateTime.class);
        return new UploadIntent(
                result.getObject("id", UUID.class),
                result.getObject("user_id", UUID.class),
                status(result.getString("status")),
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
}
