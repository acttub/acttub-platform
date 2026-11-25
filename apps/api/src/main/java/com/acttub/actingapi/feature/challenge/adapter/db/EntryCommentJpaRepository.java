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
}
