package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryCommentEntity;
import com.acttub.actingapi.platform.schema.EntryCommentStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_comments} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntryCommentJpaRepository extends Repository<EntryCommentEntity, UUID> {

    /** 보이는 댓글의 앞 40자. 지웠거나 숨긴 댓글은 없다. */
    @Query("select left(c.body, 40) from EntryCommentEntity c where c.id = :id and c.deletedAt is null and c.status = VISIBLE")
    Optional<String> visibleExcerpt(UUID id);

    record Replay(UUID id, String requestFingerprint) { }

    record Deletion(UUID id, Instant deletedAt) { }

    /** 그 회원이 같은 요청 id 로 이미 쓴 댓글. */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryCommentJpaRepository$Replay(c.id, c.requestFingerprint)
            from EntryCommentEntity c where c.userId = :userId and c.requestId = :requestId
            """)
    Optional<Replay> findReplay(UUID userId, UUID requestId);

    /** 그 회원이 그 시각부터 쓴 댓글 수(지운 것 포함 — 하루 한도). */
    @Query("select count(*) from EntryCommentEntity c where c.userId = :userId and c.createdAt >= :since")
    long countSince(UUID userId, Instant since);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryCommentEntity (id, entryId, userId, body, status, requestId, requestFingerprint, createdAt)
            values (:id, :entryId, :userId, :body, :status, :requestId, :requestFingerprint, :now)
            """)
    int insert(UUID id, UUID entryId, UUID userId, String body, EntryCommentStatus status, UUID requestId,
            String requestFingerprint, Instant now);

    /** 그 회원의 댓글 행을 잡는다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryCommentJpaRepository$Deletion(c.id, c.deletedAt)
            from EntryCommentEntity c where c.id = :id and c.userId = :userId
            """)
    Optional<Deletion> lockOwned(UUID id, UUID userId);

    /** 본문을 파기하고 지운 표시만 남긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryCommentEntity c set c.body = null, c.deletedAt = :now where c.id = :id")
    int purge(UUID id, Instant now);

    // ---- 신고 ----

    record Parent(UUID entryId, UUID userId) { }

    record Reported(UUID userId, String body) { }

    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryCommentJpaRepository$Parent(c.entryId, c.userId)
            from EntryCommentEntity c where c.id = :id
            """)
    Optional<Parent> findParent(UUID id);

    /**
     * 보는 사람에게 보이는 댓글 행을 잡는다 — 보이는 상태이고 지우지 않았으며 작성자와 어느 쪽으로도 차단이 없다. 부모 참여작이
     * 보이는지는 부르는 쪽이 따로 본다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryCommentJpaRepository$Reported(c.userId, c.body)
            from EntryCommentEntity c
            where c.id = :id and c.status = VISIBLE and c.deletedAt is null and not exists (
                select 1 from UserBlockEntity b
                where (b.blockerId = :viewer and b.blockedId = c.userId) or (b.blockedId = :viewer and b.blockerId = c.userId))
            """)
    Optional<Reported> lockVisibleTo(UUID id, UUID viewer);

    /** 댓글 행을 쓰기로 잡기만 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c.id from EntryCommentEntity c where c.id = :id")
    Optional<UUID> lockRow(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryCommentEntity c set c.status = HIDDEN where c.id = :id")
    int hide(UUID id);

    /** 운영이 신고를 풀었다 — 숨긴 댓글만 다시 보인다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryCommentEntity c set c.status = VISIBLE where c.id = :id and c.status = HIDDEN")
    int unhide(UUID id);

    /** 지운 참여작의 댓글 본문을 모두 파기한다. 이미 지운 댓글의 시각은 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryCommentEntity c set c.body = null, c.deletedAt = coalesce(c.deletedAt, :now) where c.entryId = :entryId")
    int purgeAllOf(UUID entryId, Instant now);
}
