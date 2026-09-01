package com.acttub.actingapi.feature.community.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.util.List;
import java.util.UUID;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 글 하나 안에서 익명 댓글 작성자에게 안정적인 번호를 할당한다.
 *
 * <p>호출자는 댓글 저장 트랜잭션을 먼저 열어야 한다. 이 클래스는 별도 트랜잭션이나
 * savepoint를 만들지 않으며, alias와 댓글이 함께 commit 또는 rollback되게 한다.
 *
 * <p>락 순서는 항상 {@code community_posts} 다음
 * {@code community_anonymous_aliases}다. 부모 글 행을 {@code FOR UPDATE}로 잠근 뒤에만
 * 기존 번호를 읽거나 다음 번호를 삽입하므로 같은 글의 할당은 직렬화된다.
 *
 * <p>번호를 <b>표시 이름으로 바꾸는 규칙은 여기 없다</b> — 그것은 {@code domain} 의
 * {@code CommunityComment.named} 가 안다. 이쪽은 번호를 발급하고 지키는 일만 한다.
 */
@Repository
class AnonymousAliasAllocator {

    private final EntityManager entityManager;

    AnonymousAliasAllocator(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /**
     * 기존 번호를 반환하거나, 해당 글에서 아직 쓰지 않은 다음 번호를 할당한다.
     *
     * @throws IllegalStateException 트랜잭션 밖에서 호출했거나 부모 글이 없을 때
     */
    int ensureAlias(UUID postId, UUID userId) {
        requireTransaction();
        lockPost(postId);

        List<Tuple> existing = list(entityManager.createNativeQuery("""
                SELECT ordinal AS ordinal
                FROM community_anonymous_aliases
                WHERE post_id = :postId
                  AND user_id = :userId
                """, Tuple.class)
                .setParameter("postId", postId)
                .setParameter("userId", userId));
        if (!existing.isEmpty()) {
            return existing.getFirst().get("ordinal", Integer.class);
        }

        List<Tuple> nextRows = list(entityManager.createNativeQuery("""
                SELECT COALESCE(MAX(ordinal), 0) + 1 AS next_ordinal
                FROM community_anonymous_aliases
                WHERE post_id = :postId
                """, Tuple.class)
                .setParameter("postId", postId));
        Integer nextOrdinal = nextRows.getFirst().get("next_ordinal", Integer.class);
        if (nextOrdinal == null) {
            throw new IllegalStateException("could not calculate an anonymous alias");
        }

        List<Tuple> inserted = list(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO community_anonymous_aliases (id,post_id,user_id,ordinal)
                    VALUES (:id,:postId,:userId,:ordinal)
                    ON CONFLICT ON CONSTRAINT uq_community_alias_post_user
                    DO UPDATE SET user_id=EXCLUDED.user_id
                    RETURNING ordinal
                )
                SELECT ordinal AS ordinal FROM inserted
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("postId", postId)
                .setParameter("userId", userId)
                .setParameter("ordinal", nextOrdinal));
        if (inserted.size() != 1) {
            throw new IllegalStateException("anonymous alias insert returned no row");
        }
        return inserted.getFirst().get("ordinal", Integer.class);
    }

    private void lockPost(UUID postId) {
        List<Tuple> posts = list(entityManager.createNativeQuery("""
                SELECT id AS id
                FROM community_posts
                WHERE id = :postId
                FOR UPDATE
                """, Tuple.class)
                .setParameter("postId", postId));
        if (posts.isEmpty()) {
            throw new IllegalStateException("community post is missing");
        }
    }

    private void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException(
                    "anonymous alias allocation requires an active transaction");
        }
    }
}
