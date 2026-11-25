package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.ChallengeEntryEntity;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.ChallengeEntryVisibility;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.Repository;

/**
 * {@code challenge_entries} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 엔티티가 아니라 값으로 읽는다 — 같은 트랜잭션에
 * 이 표를 고치는 네이티브 SQL 이 남아 있어, 영속성 컨텍스트에 둔 엔티티는 낡은 값을 돌려준다(§5-4).
 */
interface ChallengeEntryJpaRepository extends Repository<ChallengeEntryEntity, UUID> {

    record Parent(UUID userId, UUID challengeId) { }

    record Content(int contentVersion, String caption) { }

    /** 지우지 않은 참여작의 작성자와 챌린지. */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Parent(e.userId, e.challengeId)
            from ChallengeEntryEntity e where e.id = :id and e.status <> DELETED
            """)
    Optional<Parent> findLive(UUID id);

    /** 참여작 행을 쓰기로 잡는다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> lockForWrite(UUID id);

    /** 참여작 행을 읽기로 잡는다({@code for share}). 읽기끼리는 함께 쥐고, 고치려는 쪽은 기다린다. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> lockForRead(UUID id);

    /** 참여작 행을 쓰기로 잡기만 한다. 상태는 보지 않는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e.id from ChallengeEntryEntity e where e.id = :id")
    Optional<UUID> lockRow(UUID id);

    /** 그 회원의 지우지 않은 참여작이면 그 id. */
    @Query("select e.id from ChallengeEntryEntity e where e.id = :id and e.userId = :userId and e.status <> DELETED")
    Optional<UUID> findLiveOwnedBy(UUID id, UUID userId);

    @Query("select e.challengeId from ChallengeEntryEntity e where e.id = :id")
    Optional<UUID> findChallengeId(UUID id);

    /** 그 회원의 지우지 않은 참여작 수(비공개 포함). */
    @Query("select count(*) from ChallengeEntryEntity e where e.userId = :userId and e.status <> DELETED")
    long countLiveOwnedBy(UUID userId);

    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> findContent(UUID id);

    /** 신고·AI 판정이 보이던 참여작을 숨긴다. 이미 숨겨졌거나 지운 것은 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.status = HIDDEN_BY_REPORT, e.updatedAt = :now where e.id = :id and e.status = VISIBLE")
    int hideByReport(UUID id, Instant now);

    // ---- 공개 참여작 AI 검사 ----

    record ModerationState(String moderationStatus, int moderationAttempts, int contentVersion, String caption,
            ChallengeEntryStatus status) { }

    /**
     * 검사 시도 수가 상한에 닿은 채 차례에 남은 참여작을 만든 순으로 잡는다. 다른 트랜잭션이 잡은 행은 기다리지 않고
     * 건너뛴다({@code for update … skip locked} — {@code lock.timeout=-2}).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("""
            select e.id from ChallengeEntryEntity e
            where e.moderationStatus = 'pending' and e.moderationAttempts >= :maxAttempts and e.status <> DELETED
            order by e.createdAt, e.id
            """)
    List<UUID> lockExhaustedModeration(int maxAttempts, Limit limit);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$ModerationState(
                e.moderationStatus, e.moderationAttempts, e.contentVersion, e.caption, e.status)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<ModerationState> lockModeration(UUID id);

    /** 판정을 붙인다. 얼굴 여부는 {@code face} 가 null 이면 이미 아는 값을 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.moderationStatus = :status, e.moderationModel = :model, e.moderatedAt = :now,
                e.faceVisible = coalesce(:face, e.faceVisible)
            where e.id = :id
            """)
    int judge(UUID id, String status, String model, Instant now, Boolean face);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.moderationStatus = 'failed', e.moderatedAt = :now where e.id = :id")
    int failModeration(UUID id, Instant now);

    /** 얼굴 여부를 모를 때만 적는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.faceVisible = :face where e.id = :id and e.faceVisible is null")
    int fillFace(UUID id, boolean face);

    // ---- 신고 ----

    /** AI 검사 상태. 검사 전이면 값이 없다. */
    @Query("select e.moderationStatus from ChallengeEntryEntity e where e.id = :id")
    Optional<String> findModerationStatus(UUID id);

    /**
     * 운영이 신고를 풀었다 — 신고 숨김을 풀고, 사람이 본 것이니 AI 판정(숨김·확인 필요·실패)을 통과로 바꾼다. 작성자의 비공개와
     * 지운 참여작은 그대로다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.status = case when e.status = HIDDEN_BY_REPORT then :visible else e.status end,
                e.moderationStatus = case when e.moderationStatus in ('flagged', 'review', 'failed') then 'passed'
                                          else e.moderationStatus end
            where e.id = :id and e.status <> DELETED
            """)
    int releaseFromReports(UUID id, ChallengeEntryStatus visible);

    // ---- 올리기 ----

    record Replay(UUID id, String requestFingerprint) { }

    /** 그 회원이 같은 요청 id 로 이미 만든 참여작(지운 것 포함). */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Replay(e.id, e.requestFingerprint)
            from ChallengeEntryEntity e where e.userId = :userId and e.requestId = :requestId
            """)
    Optional<Replay> findReplay(UUID userId, UUID requestId);

    /** 그 챌린지에 그 영상으로 낸 지우지 않은 참여작 수. */
    @Query("""
            select count(*) from ChallengeEntryEntity e
            where e.challengeId = :challengeId and e.videoId = :videoId and e.status <> DELETED
            """)
    long countLiveWithVideo(UUID challengeId, UUID videoId);

    /** 그 회원이 그 시각부터 올린 참여작 수(지운 것 포함 — 하루 한도). */
    @Query("select count(*) from ChallengeEntryEntity e where e.userId = :userId and e.createdAt >= :since")
    long countCreatedSince(UUID userId, Instant since);

    /** 내용 버전·조회수·시도 수는 표의 기본값에 맡긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ChallengeEntryEntity (id, challengeId, userId, videoId, caption, visibility, publishedAt, status, requestId,
                                              requestFingerprint, createdAt, updatedAt, faceMosaic, mosaicStatus, moderationStatus)
            values (:id, :challengeId, :userId, :videoId, :caption, :visibility, :publishedAt, :status, :requestId,
                    :requestFingerprint, :now, :now, :faceMosaic, :mosaicStatus, :moderationStatus)
            """)
    int insert(UUID id, UUID challengeId, UUID userId, UUID videoId, String caption, ChallengeEntryVisibility visibility,
            Instant publishedAt, ChallengeEntryStatus status, UUID requestId, String requestFingerprint, Instant now,
            boolean faceMosaic, String mosaicStatus, String moderationStatus);

    // ---- 고치기·지우기 ----

    record Own(UUID challengeId, UUID videoId, String caption, ChallengeEntryVisibility visibility, ChallengeEntryStatus status) { }

    record Found(UUID challengeId, ChallengeEntryStatus status) { }

    /** 그 회원의 지우지 않은 참여작이면 그 챌린지. */
    @Query("select e.challengeId from ChallengeEntryEntity e where e.id = :id and e.userId = :userId and e.status <> DELETED")
    Optional<UUID> findLiveChallengeOf(UUID id, UUID userId);

    /** 그 회원의 지우지 않은 참여작 행을 쓰기로 잡는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Own(e.challengeId, e.videoId, e.caption, e.visibility, e.status)
            from ChallengeEntryEntity e where e.id = :id and e.userId = :userId and e.status <> DELETED
            """)
    Optional<Own> lockOwned(UUID id, UUID userId);

    /** 그 회원의 참여작(지운 것 포함). */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Found(e.challengeId, e.status)
            from ChallengeEntryEntity e where e.id = :id and e.userId = :userId
            """)
    Optional<Found> findOwned(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.caption = :caption, e.contentVersion = e.contentVersion + 1, e.updatedAt = :now where e.id = :id
            """)
    int changeCaption(UUID id, String caption, Instant now);

    /** 공개로 바꾼다. 공개 시각은 처음 공개할 때만 적는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.visibility = PUBLIC, e.publishedAt = coalesce(e.publishedAt, :now), e.updatedAt = :now where e.id = :id
            """)
    int publish(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.visibility = PRIVATE, e.updatedAt = :now where e.id = :id")
    int unpublish(UUID id, Instant now);

    /** 공개 중인 참여작을 AI 검사 차례로 둔다 — 아직 검사한 적이 없거나 캡션이 바뀌었을 때만. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e set e.moderationStatus = 'pending', e.moderationAttempts = 0
            where e.id = :id and e.visibility = PUBLIC and e.status = VISIBLE and (e.moderationStatus is null or :changed = true)
            """)
    int queueModeration(UUID id, boolean changed);

    /** 지운 표시만 남기고 캡션과 영상 참조를 비운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.status = DELETED, e.caption = null, e.videoId = null, e.deletedAt = :now, e.updatedAt = :now where e.id = :id
            """)
    int markDeleted(UUID id, Instant now);

    // ---- 얼굴 모자이크 ----

    record MosaicState(String mosaicStatus, ChallengeEntryStatus status, UUID videoId) { }

    /** 켠다. 이미 만드는 중이거나 준비됐으면 0행이고, 실패한 것은 시도 수를 비워 다시 만든다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.faceMosaic = true, e.mosaicStatus = 'pending', e.mosaicAttempts = 0, e.updatedAt = :now
            where e.id = :id and (e.faceMosaic = false or e.mosaicStatus = 'failed')
            """)
    int requestMosaic(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e set e.faceMosaic = false, e.mosaicStatus = null, e.updatedAt = :now
            where e.id = :id and e.faceMosaic = true
            """)
    int turnMosaicOff(UUID id, Instant now);

    /** 만든 모자이크본의 키. 없으면 값이 없다. */
    @Query("select e.mosaicKey from ChallengeEntryEntity e where e.id = :id and e.mosaicKey is not null")
    Optional<String> findMosaicKey(UUID id);

    /** 모자이크본 참조를 푼다. 켜 둔 채면 실패로 둔다(다른 사람에게 보이지 않는다). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.mosaicKey = null, e.mosaicStatus = case when e.faceMosaic = true then 'failed' end, e.updatedAt = :now
            where e.id = :id
            """)
    int dropMosaic(UUID id, Instant now);

    /** 시도 수가 상한에 닿은 채 만드는 중으로 남은 것을 실패로 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e set e.mosaicStatus = 'failed', e.updatedAt = :now
            where e.mosaicStatus = 'pending' and e.mosaicAttempts >= :maxAttempts
            """)
    int failExhaustedMosaics(int maxAttempts, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$MosaicState(e.mosaicStatus, e.status, e.videoId)
            from ChallengeEntryEntity e where e.id = :id and e.userId = :userId
            """)
    Optional<MosaicState> lockMosaic(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.mosaicStatus = 'ready', e.mosaicKey = :key, e.updatedAt = :now where e.id = :id")
    int attachMosaic(UUID id, String key, Instant now);

    /** 집은 그 시도일 때만 실패로 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e set e.mosaicStatus = 'failed', e.updatedAt = :now
            where e.id = :id and e.mosaicStatus = 'pending' and e.mosaicAttempts = :attempts
            """)
    int failMosaic(UUID id, int attempts, Instant now);

    /** 집은 그 시도일 때만 모자이크를 끈다(가릴 얼굴이 없다). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e set e.faceMosaic = false, e.mosaicStatus = null, e.mosaicKey = null, e.updatedAt = :now
            where e.id = :id and e.mosaicStatus = 'pending' and e.mosaicAttempts = :attempts
            """)
    int skipMosaic(UUID id, int attempts, Instant now);

    // ---- 조회수 ----

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.viewCount = e.viewCount + 1 where e.id = :id")
    int countView(UUID id);
}
