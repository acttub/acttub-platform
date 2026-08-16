package com.acttub.actingapi.community.adapter.db;

import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
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

    private final JdbcTemplate jdbc;

    AnonymousAliasAllocator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 기존 번호를 반환하거나, 해당 글에서 아직 쓰지 않은 다음 번호를 할당한다.
     *
     * @throws IllegalStateException 트랜잭션 밖에서 호출했거나 부모 글이 없을 때
     */
    int ensureAlias(UUID postId, UUID userId) {
        requireTransaction();
        lockPost(postId);

        List<Integer> existing = jdbc.queryForList("""
                SELECT ordinal
                FROM community_anonymous_aliases
                WHERE post_id = ?
                  AND user_id = ?
                """, Integer.class, postId, userId);
        if (!existing.isEmpty()) {
            return existing.getFirst();
        }

        Integer nextOrdinal = jdbc.queryForObject("""
                SELECT COALESCE(MAX(ordinal), 0) + 1
                FROM community_anonymous_aliases
                WHERE post_id = ?
                """, Integer.class, postId);
        if (nextOrdinal == null) {
            throw new IllegalStateException("could not calculate an anonymous alias");
        }

        jdbc.update("""
                INSERT INTO community_anonymous_aliases (
                    id,
                    post_id,
                    user_id,
                    ordinal
                )
                VALUES (?, ?, ?, ?)
                """, UUID.randomUUID(), postId, userId, nextOrdinal);
        return nextOrdinal;
    }

    private void lockPost(UUID postId) {
        List<UUID> posts = jdbc.queryForList("""
                SELECT id
                FROM community_posts
                WHERE id = ?
                FOR UPDATE
                """, UUID.class, postId);
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
