package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.MediaRetention;
import com.acttub.actingapi.platform.schema.ConsentAction;
import com.acttub.actingapi.platform.schema.ConsentType;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 영상·녹음을 남겨도 되는가 (account.withdraw, ADR-029).
 *
 * <p>보관 문서의 <b>현재 버전</b>에 대한 마지막 결정이 동의인가를 한 문장으로 읽는다. 현재 버전에 답하지 않았으면(새 버전이 나온
 * 뒤 결정 전에 탈퇴) 거절로 본다 — 동의 없이 얼굴을 남기지 않는 쪽이 안전하다.
 */
@Repository
class PostgresMediaRetention implements MediaRetention {

    private final EntityManager entityManager;

    PostgresMediaRetention(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean granted(UUID userId) {
        return !entityManager.createQuery("""
                        select 1
                        from (select d.id as id
                              from ConsentDocumentEntity d
                              where d.type = :retention
                              order by d.publishedAt desc, d.id desc
                              limit 1) currentDocument
                        join lateral (select c.action as action
                                      from UserConsentEntity c
                                      where c.userId = :userId and c.documentId = currentDocument.id
                                      order by c.occurredAt desc, c.id desc
                                      limit 1) lastDecision
                        where lastDecision.action = :granted
                        """, Integer.class)
                .setParameter("retention", ConsentType.RETENTION)
                .setParameter("userId", userId)
                .setParameter("granted", ConsentAction.GRANTED)
                .getResultList()
                .isEmpty();
    }
}
