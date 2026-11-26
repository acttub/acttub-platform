package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.schema.PracticeEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code practices} 한 표만 읽고 쓰는 문장. 회차를 화면에 싣는 조회와 다른 기능의 표(영상·분석·대화·작업·사용자)를 함께 보는
 * 문장은 {@link PostgresPracticeRepository} 의 native 에 남았다.
 */
interface PracticeJpaRepository extends Repository<PracticeEntity, UUID> {

    /** 같은 요청 id 로 이미 만든 회차. (user_id, request_id) 가 유일하다. */
    @Query("""
            select p.id as id, p.requestFingerprint as requestFingerprint
            from PracticeEntity p
            where p.userId = :userId and p.requestId = :requestId
            """)
    Optional<Requested> requested(UUID userId, UUID requestId);

    @Query("select p.id from PracticeEntity p where p.userId = :userId and p.readingSessionId = :readingSessionId")
    List<UUID> fromReading(UUID userId, UUID readingSessionId);

    @Query("""
            select p.rootId as rootId, p.videoId as videoId, p.faceMosaic as faceMosaic
            from PracticeEntity p
            where p.id = :id and p.userId = :userId
            """)
    Optional<Source> source(UUID id, UUID userId);

    @Query("select p.rootId from PracticeEntity p where p.id = :id and p.userId = :userId")
    Optional<UUID> rootOf(UUID id, UUID userId);

    @Query("select coalesce(max(p.ordinal), 0) from PracticeEntity p where p.rootId = :rootId")
    int lastOrdinal(UUID rootId);

    /** 묶음의 첫 행을 잡는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p.id from PracticeEntity p where p.id = :rootId")
    Optional<UUID> lockGroup(UUID rootId);

    /** 이 사람의 묶음 첫 행을 잡는다. 첫 행이 아니면 빈 값이다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p.id from PracticeEntity p where p.id = :rootId and p.userId = :userId and p.rootId = :rootId")
    Optional<UUID> lockOwnGroup(UUID rootId, UUID userId);

    /** 이 사람의 회차를 잡고 단계를 읽는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p.stage from PracticeEntity p where p.id = :id and p.userId = :userId")
    Optional<String> lockStage(UUID id, UUID userId);

    @Query("select p.id from PracticeEntity p where p.rootId = :rootId and p.stage <> 'closed' order by p.ordinal")
    List<UUID> open(UUID rootId, Limit limit);

    @Query("select p.stage from PracticeEntity p where p.id = :id")
    String stage(UUID id);

    @Query("select p.closeReason from PracticeEntity p where p.id = :id")
    String closeReason(UUID id);

    /**
     * 회차 하나를 넣는다. 세션 목적을 보내지 않으면 첫 회차의 것을 이어받는다(리딩 녹음으로 시작한 묶음을 영상으로 이으면 평가 받기).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into PracticeEntity (id, userId, videoId, rootId, ordinal, stage, experienceVersion, requestId,
                                        requestFingerprint, situation, characterContext, goal, blockageKind, subBranch,
                                        blockageDetail, title, sessionPurpose, faceMosaic, language, createdAt, updatedAt)
            values (:id, :userId, :videoId, :rootId, :ordinal, :stage, :experienceVersion, :requestId, :fingerprint,
                    :situation, :characterContext, :goal, :blockageKind, :subBranch, :blockageNote, :title,
                    coalesce(:sessionPurpose,
                             (select case when r.sessionPurpose = 'reading' then 'evaluate' else r.sessionPurpose end
                              from PracticeEntity r where r.id = :rootId)),
                    coalesce(:faceMosaic, false), :language, :now, :now)
            """)
    int insert(UUID id, UUID userId, UUID videoId, UUID rootId, int ordinal, String stage, String experienceVersion,
            UUID requestId, String fingerprint, String situation, String characterContext, String goal,
            String blockageKind, String subBranch, String blockageNote, String title, String sessionPurpose,
            Boolean faceMosaic, String language, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PracticeEntity p set p.readingSessionId = :readingSessionId where p.id = :id")
    int linkReading(UUID id, UUID readingSessionId);

    /** 보낸 것만 바꾼다. 숨김은 처음 숨긴 시각을 지키고 풀면 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update PracticeEntity p
            set p.favorite = coalesce(:favorite, p.favorite),
                p.hiddenAt = case when :hidden is null then p.hiddenAt
                                  when :hidden = true then coalesce(p.hiddenAt, :now)
                                  else null end,
                p.title = coalesce(:title, p.title),
                p.updatedAt = :now
            where p.id = :rootId
            """)
    int updateGroup(UUID rootId, Boolean favorite, Boolean hidden, String title, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PracticeEntity p set p.userId = :to where p.userId = :from")
    int reassign(UUID from, UUID to);

    interface Requested {
        UUID getId();

        String getRequestFingerprint();
    }

    interface Source {
        UUID getRootId();

        UUID getVideoId();

        boolean getFaceMosaic();
    }
}
