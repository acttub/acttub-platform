package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.CoachConversationEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code coach_conversations} 한 표만 읽고 쓰는 문장. 회차·영상·분석·사용자를 함께 보는 문장(엔진이 읽는 묶음, 주인 확인, 회차
 * 닫기·되돌리기)은 {@link PostgresConversationRepository} 의 native 에 남았다.
 */
interface CoachConversationJpaRepository extends Repository<CoachConversationEntity, UUID> {

    /** 회차에 대화는 하나다. 이미 있으면 넣지 않는다(0). 상태와 revision 은 DB 기본값({}·0)이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CoachConversationEntity (id, practiceId, startRequestId, status, createdAt, updatedAt)
            values (:id, :practiceId, :startRequestId, 'open', :now, :now)
            on conflict (practiceId) do nothing
            """)
    int open(UUID id, UUID practiceId, UUID startRequestId, Instant now);

    @Query("select c.id from CoachConversationEntity c where c.practiceId = :practiceId")
    UUID ofPractice(UUID practiceId);

    /** 대화 행을 잡는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c.id from CoachConversationEntity c where c.id = :id")
    Optional<UUID> lock(UUID id);

    /** 대화 행을 잡고 저장 직전의 revision 과 상태를 읽는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c.stateRevision as stateRevision, c.status as status from CoachConversationEntity c where c.id = :id")
    Optional<Locked> lockState(UUID id);

    interface Locked {
        int getStateRevision();

        String getStatus();
    }

    /** 시작 응답을 저장하며 상태를 갈아 끼운다. 종료 사유가 있으면 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CoachConversationEntity c
            set c.state = :state, c.stateRevision = c.stateRevision + 1,
                c.status = case when :closeReason is null then 'open' else 'closed' end,
                c.closeReason = :closeReason,
                c.closedAt = case when :closeReason is null then c.closedAt else :now end,
                c.updatedAt = :now
            where c.id = :id
            """)
    int saveOpening(UUID id, String state, String closeReason, Instant now);

    /** 한 턴을 저장하며 상태를 갈아 끼운다. closed 로 저장할 때만 닫힌 시각을 적는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CoachConversationEntity c
            set c.state = :state, c.stateRevision = c.stateRevision + 1,
                c.status = :status, c.closeReason = :closeReason,
                c.closedAt = case when :status = 'closed' then :now else c.closedAt end,
                c.updatedAt = :now
            where c.id = :id
            """)
    int saveTurn(UUID id, String state, String status, String closeReason, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CoachConversationEntity c
            set c.state = :state, c.stateRevision = c.stateRevision + 1,
                c.status = 'open', c.closeReason = null, c.closedAt = null, c.updatedAt = :now
            where c.id = :id
            """)
    int reopen(UUID id, String state, Instant now);
}
