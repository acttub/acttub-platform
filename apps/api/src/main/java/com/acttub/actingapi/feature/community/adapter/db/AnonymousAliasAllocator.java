package com.acttub.actingapi.feature.community.adapter.db;

import java.util.Optional;
import java.util.UUID;

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

    private final CommunityPostJpaRepository posts;
    private final CommunityAnonymousAliasJpaRepository aliases;

    AnonymousAliasAllocator(CommunityPostJpaRepository posts, CommunityAnonymousAliasJpaRepository aliases) {
        this.posts = posts;
        this.aliases = aliases;
    }

    /**
     * 기존 번호를 반환하거나, 해당 글에서 아직 쓰지 않은 다음 번호를 할당한다.
     *
     * <p>넣기는 {@code ON CONFLICT … DO UPDATE} 한 문장이고, 받은 번호는 같은 트랜잭션에서 다시 읽는다(HQL 에
     * {@code RETURNING} 이 없다). 넣었든 이미 있었든 그 행은 이 트랜잭션이 잡고 있다.
     *
     * @throws IllegalStateException 트랜잭션 밖에서 호출했거나 부모 글이 없을 때
     */
    int ensureAlias(UUID postId, UUID userId) {
        requireTransaction();
        if (posts.lock(postId).isEmpty()) {
            throw new IllegalStateException("community post is missing");
        }
        Optional<Integer> existing = aliases.ordinalOf(postId, userId);
        if (existing.isPresent()) {
            return existing.get();
        }
        aliases.insertOrKeep(UUID.randomUUID(), postId, userId, aliases.nextOrdinal(postId));
        return aliases.ordinalOf(postId, userId)
                .orElseThrow(() -> new IllegalStateException("anonymous alias insert returned no row"));
    }

    private void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException(
                    "anonymous alias allocation requires an active transaction");
        }
    }
}
