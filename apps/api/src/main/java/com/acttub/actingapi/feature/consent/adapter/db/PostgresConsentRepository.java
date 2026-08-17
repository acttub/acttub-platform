package com.acttub.actingapi.feature.consent.adapter.db;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.PendingConsent;
import com.acttub.actingapi.feature.auth.app.PendingConsentDocuments;
import com.acttub.actingapi.feature.consent.app.ConsentRepository;
import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import com.acttub.actingapi.platform.security.PendingConsentGate;
import com.acttub.actingapi.platform.schema.ConsentAction;
import com.acttub.actingapi.platform.schema.ConsentType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 동의 문서와 그 이력을 소유한 쪽이 그것을 묻는 <b>바깥 포트 둘도 직접</b> 구현한다 —
 * 위임만 하는 어댑터를 끼우지 않는다 (ADR-017, SOMA-397 6단계의 {@code SyncOperationService}
 * 와 같은 형태).
 *
 * <p>요구가 셋이고 그중 둘은 바깥에서 온다. 배관은 "막을 것인가"만 묻고
 * ({@link PendingConsentGate}), {@code auth} 는 로그인 응답에 실을 문서 자체를 묻는다
 * ({@link PendingConsentDocuments}). 종전에는 그 둘을 {@code auth} 가 자기 SQL 로 답했다
 * (SOMA-397 12단계에서 회수).
 */
@Repository
class PostgresConsentRepository
        implements ConsentRepository, PendingConsentDocuments, PendingConsentGate {
    private final JdbcTemplate jdbc;

    PostgresConsentRepository(JdbcTemplate jdbc) {
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
     * 이 정렬은 결과 순서만이 아니라 <b>어느 행이 선택되는지</b>까지 좌우한다 (apps/api/CONTRACT.md §5-8).
     */
    @Override
    public List<ConsentDocument> listLatestDocuments() {
        return jdbc.query("""
                SELECT DISTINCT ON(consent_documents.type)
                       id,type::text,version,title,body,required,published_at
                FROM consent_documents
                ORDER BY consent_documents.type,
                         consent_documents.published_at DESC,
                         consent_documents.id DESC
                """, PostgresConsentRepository::document);
    }

    @Override
    public ConsentDocument findDocument(UUID documentId) {
        List<ConsentDocument> rows = jdbc.query("""
                SELECT id,type::text,version,title,body,required,published_at
                FROM consent_documents
                WHERE id=?
                """, PostgresConsentRepository::document, documentId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public List<ConsentEvent> currentConsentsOf(UUID userId) {
        return jdbc.query("""
                SELECT DISTINCT ON(document_id)
                       id,user_id,document_id,action::text,occurred_at
                FROM user_consents
                WHERE user_id=?
                ORDER BY document_id,occurred_at DESC,id DESC
                """, PostgresConsentRepository::consent, userId);
    }

    @Override
    public ConsentEvent record(UUID userId, UUID documentId, String action, Instant occurredAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,?::consent_action_t,?)
                """,
                id,
                userId,
                documentId,
                action,
                occurredAt.atOffset(ZoneOffset.UTC));
        return new ConsentEvent(id, userId, documentId, action, occurredAt);
    }

    /**
     * 아직 받지 않은 <b>필수</b> 문서 (`db/store.py:PostgresStore.list_pending_consents`).
     *
     * <p>⚠ <b>{@code ConsentService#pendingDocuments} 와 같은 것을 세지만 순서가 다르다</b> —
     * 이쪽은 <b>발행 시각 순</b>, 그쪽은 <b>종류 순</b>이다. 파이썬 정본이 두 자리를 그렇게
     * 갈라 두었고 각각 다른 엔드포인트의 응답이 되므로 합치지 않는다.
     *
     * <p>철회한 뒤 다시 동의한 경우까지 맞으려면 <b>마지막</b> 행위를 봐야 한다 — 그래서
     * 안쪽 질의가 문서마다 가장 최근 한 줄을 집는다.
     */
    @Override
    public List<PendingConsent> pendingFor(UUID userId) {
        return jdbc.query("""
                WITH latest AS (SELECT DISTINCT ON(type) * FROM consent_documents ORDER BY type,published_at DESC,id DESC)
                SELECT d.id,d.type::text,d.version,d.title,d.body,d.required,d.published_at
                FROM latest d WHERE d.required AND NOT EXISTS(
                  SELECT 1 FROM user_consents c WHERE c.user_id=? AND c.document_id=d.id AND c.action='granted'::consent_action_t
                  AND c.id=(SELECT c2.id FROM user_consents c2 WHERE c2.user_id=c.user_id AND c2.document_id=c.document_id ORDER BY c2.occurred_at DESC,c2.id DESC LIMIT 1))
                ORDER BY d.published_at,d.id
                """,
                (result, rowNumber) -> new PendingConsent(
                        result.getObject(1, UUID.class),
                        type(result.getString(2)),
                        result.getString(3),
                        result.getString(4),
                        result.getString(5),
                        result.getBoolean(6),
                        result.getObject(7, OffsetDateTime.class).toInstant()),
                userId);
    }

    @Override
    public boolean hasPending(UUID userId) {
        return !pendingFor(userId).isEmpty();
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
    private static String type(String raw) {
        return ConsentType.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    private static String action(String raw) {
        return ConsentAction.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

    private static ConsentDocument document(ResultSet result, int rowNumber) throws SQLException {
        return new ConsentDocument(
                result.getObject("id", UUID.class),
                type(result.getString("type")),
                result.getString("version"),
                result.getString("title"),
                result.getString("body"),
                result.getBoolean("required"),
                result.getObject("published_at", OffsetDateTime.class).toInstant());
    }

    private static ConsentEvent consent(ResultSet result, int rowNumber) throws SQLException {
        return new ConsentEvent(
                result.getObject("id", UUID.class),
                result.getObject("user_id", UUID.class),
                result.getObject("document_id", UUID.class),
                action(result.getString("action")),
                result.getObject("occurred_at", OffsetDateTime.class).toInstant());
    }
}
