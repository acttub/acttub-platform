package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.app.ReadingConsents;
import com.acttub.actingapi.platform.schema.ConsentAction;
import com.acttub.actingapi.platform.schema.ConsentType;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 대본 리딩의 AI 처리 동의 판정. 문장 수는 리딩이 직접 읽던 때와 같다: 나누기는 한 문장, 고품질 목소리는 개인정보 동의로 끝나면 한
 * 문장이고 아니면 두 문장이다.
 *
 * <p>개인정보 동의의 버전 번호를 정규식({@code ~})으로 읽는 판정은 HQL 에 없어 native SQL 로 둔다(apps/api/CONTRACT.md §5-9).
 *
 * <p>리딩의 대본 올리기에는 같은 판정을 자기 문장 안에서 행마다 읽는 자리가 둘 있다(실패 원본의 보관 시한, 미연결 정리,
 * {@code PostgresScriptUploadRepository}). 그 식은 리딩에 남아 있으므로 여기의 규칙을 바꾸면 그쪽도 함께 바꾼다 — 둘이 같은 답을
 * 내는지는 {@code ScriptUploadConsentParityIT} 가 본다.
 */
@Repository
class PostgresReadingConsents implements ReadingConsents {

    /** 개인정보 수집·이용 동의가 대본 리딩의 AI 처리(대본 나누기·고품질 목소리)를 품기 시작한 버전. */
    private static final int PRIVACY_COVERS_READING_FROM = 9;

    /**
     * 그 사람이 개인정보 수집·이용 동의 v9 이상에 동의한 상태인가. 문서마다 그 문서에 대한 마지막 행위가 동의인지 본다 — 탈퇴 뒤
     * 운영자가 남기는 철회는 동의로 치지 않는다.
     */
    private static final String PRIVACY_COVERS_READING = """
            EXISTS (SELECT 1 FROM consent_documents pd
                    WHERE pd.type='privacy'
                      AND (CASE WHEN pd.version ~ '^v[0-9]+$' THEN CAST(substring(pd.version FROM 2) AS integer) ELSE 0 END) >= %d
                      AND (SELECT pc.action FROM user_consents pc
                           WHERE pc.user_id=:userId AND pc.document_id=pd.id
                           ORDER BY pc.occurred_at DESC,pc.id DESC LIMIT 1)='granted')""".formatted(PRIVACY_COVERS_READING_FROM);

    private final EntityManager entityManager;

    PostgresReadingConsents(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public String scriptSplit(UUID userId) {
        Object action = entityManager.createNativeQuery("""
                SELECT (CASE WHEN %s THEN 'granted' ELSE
                (SELECT c.action FROM user_consents c
                 WHERE c.user_id=:userId
                   AND c.document_id=(SELECT d.id FROM consent_documents d WHERE d.type='script_split' AND d.locale='ko'
                                      ORDER BY d.published_at DESC,d.id DESC LIMIT 1)
                 ORDER BY c.occurred_at DESC,c.id DESC LIMIT 1) END) AS action
                """.formatted(PRIVACY_COVERS_READING))
                .setParameter("userId", userId)
                .getResultList().getFirst();
        if (action == null) {
            return "undecided";
        }
        return "granted".equals(action) ? "granted" : "denied";
    }

    @Override
    public String cloudVoice(UUID userId) {
        Object covered = entityManager.createNativeQuery("SELECT " + PRIVACY_COVERS_READING)
                .setParameter("userId", userId)
                .getResultList().getFirst();
        if (Boolean.TRUE.equals(covered)) {
            return "granted";
        }
        List<ConsentAction> decided = entityManager.createQuery("""
                        select lastDecision.action
                        from (select d.id as id
                              from ConsentDocumentEntity d
                              where d.type = :cloudVoice and d.locale = 'ko'
                              order by d.publishedAt desc, d.id desc
                              limit 1) currentDocument
                        join lateral (select c.action as action
                                      from UserConsentEntity c
                                      where c.userId = :userId and c.documentId = currentDocument.id
                                      order by c.occurredAt desc, c.id desc
                                      limit 1) lastDecision
                        """, ConsentAction.class)
                .setParameter("cloudVoice", ConsentType.CLOUD_VOICE)
                .setParameter("userId", userId)
                .getResultList();
        if (decided.isEmpty()) {
            return "undecided";
        }
        return decided.getFirst() == ConsentAction.GRANTED ? "granted" : "denied";
    }
}
