package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryRankingSnapshotEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_ranking_snapshots}(좋아요순의 굳힌 순서)를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntryRankingSnapshotJpaRepository extends Repository<EntryRankingSnapshotEntity, UUID> {

    /** 그 보는 사람이 그 챌린지에서 굳힌 순서. 남의 것이나 다른 챌린지의 것은 없다. */
    Optional<EntryRankingSnapshotEntity> findByIdAndChallengeIdAndViewerId(UUID id, UUID challengeId, UUID viewerId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryRankingSnapshotEntity (id, challengeId, viewerId, basis, entryIds, ranks, createdAt)
            values (:id, :challengeId, :viewerId, :basis, :entryIds, :ranks, :now)
            """)
    int insert(UUID id, UUID challengeId, UUID viewerId, String basis, UUID[] entryIds, Integer[] ranks, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntryRankingSnapshotEntity s where s.createdAt < :before")
    int deleteOlderThan(Instant before);
}
