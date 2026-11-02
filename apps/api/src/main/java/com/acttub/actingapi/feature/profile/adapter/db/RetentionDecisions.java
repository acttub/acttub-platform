package com.acttub.actingapi.feature.profile.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;

/**
 * 「영상·녹음 보관·활용」 동의의 판정 한 자리 — 탈퇴·연습 삭제·지운 영상 파기가 같은 기준을 쓴다.
 *
 * <p>보관 문서의 <b>현재 판</b>에 대한 마지막 결정이 동의일 때만 보관한다. 현재 판에 답하지 않았으면(새 판이 나온 뒤
 * 아직 결정 전) 거절로 본다 — 동의 없이 얼굴을 남기지 않는 쪽이 안전하다. 그래서 탈퇴만 다루던 v1 에 동의한 사람의
 * 지운 연습 영상은, 연습 삭제까지 다루는 판에 다시 동의하기 전에는 남지 않는다.
 */
final class RetentionDecisions {

    /** {@code %s} 자리에 사람 id 의 SQL 식을 넣어 쓰는 EXISTS 식. */
    static final String GRANTED_SQL = """
            EXISTS(SELECT 1
                   FROM (SELECT id
                         FROM consent_documents
                         WHERE type='retention'
                         ORDER BY published_at DESC,id DESC
                         LIMIT 1) current_document
                   JOIN LATERAL (SELECT action
                                 FROM user_consents
                                 WHERE user_consents.user_id=%s
                                   AND user_consents.document_id=current_document.id
                                 ORDER BY occurred_at DESC,id DESC
                                 LIMIT 1) last_decision ON true
                   WHERE last_decision.action='granted')
            """;

    private RetentionDecisions() {
    }

    static boolean granted(EntityManager entityManager, UUID userId) {
        return !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT 1 AS granted WHERE " + GRANTED_SQL.formatted(":userId"), Tuple.class)
                .setParameter("userId", userId)).isEmpty();
    }
}
