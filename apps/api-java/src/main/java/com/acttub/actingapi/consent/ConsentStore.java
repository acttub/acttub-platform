package com.acttub.actingapi.consent;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.domain.ConsentAction;
import com.acttub.actingapi.domain.ConsentType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ConsentStore {
    private final JdbcTemplate jdbc;

    ConsentStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * `db/store.py:PostgresStore.list_latest_consent_documents` 대응.
     *
     * <p><b>{@code ORDER BY} 는 반드시 테이블을 한정한다.</b> {@code SELECT type::text} 는 출력
     * 컬럼 이름을 그대로 {@code type} 으로 만들고, Postgres 의 {@code ORDER BY} 는 출력 별칭을
     * 먼저 본다. 한정하지 않으면 enum 이 아니라 <b>그 텍스트</b>로 정렬돼
     * {@code terms, privacy} 가 {@code privacy, terms} 로 뒤집힌다 — enum 은 선언 순서로,
     * 텍스트는 알파벳 순으로 정렬되기 때문이다. {@code DISTINCT ON} 은 그룹마다 첫 행을 고르므로
     * 이 정렬은 결과 순서만이 아니라 <b>어느 행이 선택되는지</b>까지 좌우한다 (/SPEC.md §5-8).
     */
    List<ConsentDocumentRow> listLatestDocuments() {
        return jdbc.query("""
                SELECT DISTINCT ON(consent_documents.type)
                       id,type::text,version,title,body,required,published_at
                FROM consent_documents
                ORDER BY consent_documents.type,
                         consent_documents.published_at DESC,
                         consent_documents.id DESC
                """, ConsentStore::document);
    }

    ConsentDocumentRow findDocument(UUID documentId) {
        List<ConsentDocumentRow> rows = jdbc.query("""
                SELECT id,type::text,version,title,body,required,published_at
                FROM consent_documents
                WHERE id=?
                """, ConsentStore::document, documentId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    List<UserConsentRow> getCurrentUserConsents(UUID userId) {
        return jdbc.query("""
                SELECT DISTINCT ON(document_id)
                       id,user_id,document_id,action::text,occurred_at
                FROM user_consents
                WHERE user_id=?
                ORDER BY document_id,occurred_at DESC,id DESC
                """, ConsentStore::consent, userId);
    }

    UserConsentRow recordConsent(
            UUID userId,
            UUID documentId,
            ConsentAction action,
            Instant occurredAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,?::consent_action_t,?)
                """,
                id,
                userId,
                documentId,
                action.dbValue(),
                occurredAt.atOffset(ZoneOffset.UTC));
        return new UserConsentRow(id, userId, documentId, action, occurredAt);
    }

    private static ConsentDocumentRow document(ResultSet result, int rowNumber) throws SQLException {
        return new ConsentDocumentRow(
                result.getObject("id", UUID.class),
                ConsentType.valueOf(result.getString("type").toUpperCase(Locale.ROOT)),
                result.getString("version"),
                result.getString("title"),
                result.getString("body"),
                result.getBoolean("required"),
                result.getObject("published_at", OffsetDateTime.class).toInstant());
    }

    private static UserConsentRow consent(ResultSet result, int rowNumber) throws SQLException {
        return new UserConsentRow(
                result.getObject("id", UUID.class),
                result.getObject("user_id", UUID.class),
                result.getObject("document_id", UUID.class),
                ConsentAction.valueOf(result.getString("action").toUpperCase(Locale.ROOT)),
                result.getObject("occurred_at", OffsetDateTime.class).toInstant());
    }

    record ConsentDocumentRow(
            UUID id,
            ConsentType type,
            String version,
            String title,
            String body,
            boolean required,
            Instant publishedAt) {
    }

    record UserConsentRow(
            UUID id,
            UUID userId,
            UUID documentId,
            ConsentAction action,
            Instant occurredAt) {
    }
}
