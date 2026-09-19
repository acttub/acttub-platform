package com.acttub.actingapi.feature.consent.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

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
 * 동의 문서와 그 이력의 저장소.
 *
 * <p>문서와 결정을 함께 해석하는 일(미결정 판정, 가입 결정의 확인)은 여기가 아니라
 * {@code ConsentService} 가 한다 — 바깥 포트도 그쪽이 구현한다. 여기는 읽고 쌓기만 한다.
 */
@Repository
class PostgresConsentRepository implements ConsentRepository {
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
     * <p><b>응답 순서는 약관 · 수집·이용 동의 · AI 분석 · 탈퇴 후 보관이다</b> — 동의 화면이 그
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
                             WHEN 'retention' THEN 4
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
