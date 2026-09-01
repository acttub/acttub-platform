package com.acttub.actingapi.feature.consent.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.PendingConsent;
import com.acttub.actingapi.feature.auth.app.PendingConsentDocuments;
import com.acttub.actingapi.feature.consent.app.ConsentRepository;
import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import com.acttub.actingapi.feature.consent.schema.ConsentDocumentEntity;
import com.acttub.actingapi.feature.consent.schema.UserConsentEntity;
import com.acttub.actingapi.platform.schema.ConsentAction;
import com.acttub.actingapi.platform.schema.ConsentType;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 동의 문서와 그 이력을 소유한 쪽이 그것을 묻는 <b>바깥 포트도 직접</b> 구현한다 —
 * 위임만 하는 어댑터를 끼우지 않는다 (ADR-017, SOMA-397 6단계의 {@code SyncOperationService}
 * 와 같은 형태).
 *
 * <p>{@code auth} 는 로그인 응답에 실을 문서 자체를 묻는다({@link PendingConsentDocuments}).
 * 필수 동의의 세 갈래 접근 판정은 문서와 결정을 함께 해석하는 {@code ConsentService}가
 * 배관의 포트를 구현한다. 종전에는 두 질문을 모두 {@code auth} 가 자기 SQL 로 답했다
 * (SOMA-397 12단계에서 회수).
 */
@Repository
class PostgresConsentRepository implements ConsentRepository, PendingConsentDocuments {
    private final ConsentDocumentJpaRepository documents;
    private final UserConsentJpaRepository consents;
    private final EntityManager entityManager;

    PostgresConsentRepository(
            ConsentDocumentJpaRepository documents,
            UserConsentJpaRepository consents,
            EntityManager entityManager) {
        this.documents = documents;
        this.consents = consents;
        this.entityManager = entityManager;
    }

    /**
     * `db/store.py:PostgresStore.list_latest_consent_documents` 대응.
     *
     * <p><b>응답 순서는 약관·개인정보·AI 분석이다</b> — 웹의 동의 화면과 ops 대시보드가 그
     * 순서로 그린다. {@code consent_type_t} 이던 시절에는 enum 정의 순서가 이 일을 대신했지만,
     * text 가 된 지금은 사전순({@code ai_analysis, privacy, terms})으로 뒤집힌다.
     * 그래서 바깥에서 {@code CASE} 로 못박는다 (SOMA-462).
     *
     * <p><b>안쪽 질의는 건드리지 않는다.</b> {@code DISTINCT ON} 은 {@code ORDER BY} 선행
     * 표현식이 자기와 같기를 요구해서, 안쪽에 {@code CASE} 를 넣으면
     * {@code SELECT DISTINCT ON expressions must match initial ORDER BY expressions} 로
     * 거부당한다. 안쪽의 정렬은 종류마다 <b>어느 판을 고를지</b>(가장 최근 것)를 정하는
     * 일이고, 바깥 정렬은 고른 것들을 보여줄 순서를 정하는 일이다 (apps/api/CONTRACT.md §5-8).
     */
    @Override
    public List<ConsentDocument> listLatestDocuments() {
        return list(entityManager.createNativeQuery("""
                SELECT id,type,version,title,body,required,published_at
                FROM (SELECT DISTINCT ON(consent_documents.type)
                             id,type,version,title,body,required,published_at
                      FROM consent_documents
                      ORDER BY consent_documents.type,
                               consent_documents.published_at DESC,
                               consent_documents.id DESC) latest
                ORDER BY CASE latest.type
                             WHEN 'terms' THEN 1
                             WHEN 'privacy' THEN 2
                             WHEN 'ai_analysis' THEN 3
                         END
                """, Tuple.class)).stream()
                .map(PostgresConsentRepository::document)
                .toList();
    }

    @Override
    public ConsentDocument findDocument(UUID documentId) {
        return documents.findById(documentId)
                .map(PostgresConsentRepository::document)
                .orElse(null);
    }

    @Override
    public List<ConsentEvent> currentConsentsOf(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT DISTINCT ON(document_id)
                       id,user_id,document_id,action,occurred_at
                FROM user_consents
                WHERE user_id=:userId
                ORDER BY document_id,occurred_at DESC,id DESC
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(PostgresConsentRepository::consent)
                .toList();
    }

    @Override
    public ConsentEvent record(UUID userId, UUID documentId, String action, Instant occurredAt) {
        UUID id = UUID.randomUUID();
        consents.save(new UserConsentEntity(
                id,
                userId,
                documentId,
                ConsentAction.valueOf(action.toUpperCase(Locale.ROOT)),
                occurredAt));
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
        return list(entityManager.createNativeQuery("""
                WITH latest AS (SELECT DISTINCT ON(type) * FROM consent_documents ORDER BY type,published_at DESC,id DESC)
                SELECT d.id,d.type,d.version,d.title,d.body,d.required,d.published_at
                FROM latest d WHERE d.required AND NOT EXISTS(
                  SELECT 1 FROM user_consents c WHERE c.user_id=:userId AND c.document_id=d.id AND c.action='granted'
                  AND c.id=(SELECT c2.id FROM user_consents c2 WHERE c2.user_id=c.user_id AND c2.document_id=c.document_id ORDER BY c2.occurred_at DESC,c2.id DESC LIMIT 1))
                ORDER BY d.published_at,d.id
                """,
                Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> new PendingConsent(
                        row.get("id", UUID.class),
                        type(row.get("type", String.class)),
                        row.get("version", String.class),
                        row.get("title", String.class),
                        row.get("body", String.class),
                        row.get("required", Boolean.class),
                        row.get("published_at", Instant.class)))
                .toList();
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

    private static ConsentDocument document(ConsentDocumentEntity entity) {
        return new ConsentDocument(
                entity.getId(),
                entity.getType().dbValue(),
                entity.getVersion(),
                entity.getTitle(),
                entity.getBody(),
                entity.isRequired(),
                entity.getPublishedAt());
    }

    private static ConsentDocument document(Tuple row) {
        return new ConsentDocument(
                row.get("id", UUID.class),
                type(row.get("type", String.class)),
                row.get("version", String.class),
                row.get("title", String.class),
                row.get("body", String.class),
                row.get("required", Boolean.class),
                row.get("published_at", Instant.class));
    }

    private static ConsentEvent consent(Tuple row) {
        return new ConsentEvent(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("document_id", UUID.class),
                action(row.get("action", String.class)),
                row.get("occurred_at", Instant.class));
    }

}
