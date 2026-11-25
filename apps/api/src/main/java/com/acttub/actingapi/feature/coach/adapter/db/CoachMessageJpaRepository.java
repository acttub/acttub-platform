package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.CoachMessageEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code coach_messages} 를 읽고 쓰는 문장. 재전송 판정만 대화 행({@code coach_conversations})을 함께 읽는다. */
interface CoachMessageJpaRepository extends Repository<CoachMessageEntity, UUID> {

    /** 엔진이 읽는 턴 — 저장된 역할 그대로다. */
    @Query("""
            select m.role as role, m.text as text
            from CoachMessageEntity m
            where m.conversationId = :conversationId
            order by m.turnIndex
            """)
    List<Spoken> spoken(UUID conversationId);

    interface Spoken {
        String getRole();

        String getText();
    }

    /** 화면에 싣는 턴. */
    @Query("""
            select m.turnIndex as turnIndex, m.role as role, m.text as text, m.createdAt as createdAt
            from CoachMessageEntity m
            where m.conversationId = :conversationId
            order by m.turnIndex
            """)
    List<Shown> shown(UUID conversationId);

    interface Shown {
        int getTurnIndex();

        String getRole();

        String getText();

        Instant getCreatedAt();
    }

    @Query("select count(*) from CoachMessageEntity m where m.conversationId = :conversationId")
    long turns(UUID conversationId);

    /** 시작 응답을 넣어 센 코치 응답 수. 응답 상한(무료 코칭의 배우 답 수 + 1 포함)이 이 수와 견준다. */
    @Query("select count(*) from CoachMessageEntity m where m.conversationId = :conversationId and m.role = 'ai'")
    long coachReplies(UUID conversationId);

    @Query("select coalesce(max(m.turnIndex) + 1, 0) from CoachMessageEntity m where m.conversationId = :conversationId")
    int nextIndex(UUID conversationId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CoachMessageEntity (id, conversationId, turnIndex, role, text, requestId, requestFingerprint, createdAt)
            values (:id, :conversationId, :turnIndex, :role, :text, :requestId, :fingerprint, :now)
            """)
    int insert(UUID id, UUID conversationId, int turnIndex, String role, String text, UUID requestId, String fingerprint,
            Instant now);

    /**
     * 같은 요청 id 가 만든 배우 턴과, 그 뒤의 첫 코치 말·뒤에 쌓인 배우 답 수·그 응답까지의 턴 수. 요청마다 도는 조회라 한 문장이다.
     */
    @Query("""
            select m.requestFingerprint as requestFingerprint, c.status as status, c.closeReason as closeReason,
                   c.stateRevision as stateRevision,
                   (select later.text from CoachMessageEntity later
                    where later.conversationId = m.conversationId and later.turnIndex > m.turnIndex and later.role = 'ai'
                    order by later.turnIndex limit 1) as coachMessage,
                   (select count(*) from CoachMessageEntity later
                    where later.conversationId = m.conversationId and later.role = 'actor'
                      and later.turnIndex > m.turnIndex) as laterReplies,
                   (select count(*) from CoachMessageEntity previous
                    where previous.conversationId = m.conversationId
                      and previous.turnIndex <= m.turnIndex + 1) as responseTurnCount
            from CoachMessageEntity m
            join CoachConversationEntity c on c.id = m.conversationId
            where m.conversationId = :conversationId and m.requestId = :requestId
            """)
    Optional<Replayed> replayed(UUID conversationId, UUID requestId);

    interface Replayed {
        String getRequestFingerprint();

        String getStatus();

        String getCloseReason();

        int getStateRevision();

        String getCoachMessage();

        long getLaterReplies();

        long getResponseTurnCount();
    }
}
