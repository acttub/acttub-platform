package com.acttub.actingapi.feature.message.adapter.db;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.challenge.app.UserBlocking;
import com.acttub.actingapi.feature.community.app.CommunityService;
import com.acttub.actingapi.feature.message.app.MessageRepository;
import com.acttub.actingapi.feature.message.domain.MessageRules;
import com.acttub.actingapi.feature.message.schema.DirectConversationEntity;
import com.acttub.actingapi.feature.message.schema.DirectMessageEntity;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 1:1 메시지 포트를 JPA 로 구현한다 (docs/specs/community/messages.md).
 *
 * <p><b>트랜잭션 경계가 이 클래스 안에 있다.</b> 대화 시작과 보내기는 두 사람의 계정 행을 id 순서로 잠그고(auth 의
 * {@link AccountRowLock}) 그 안에서 활성·차단·하루 한도를 본다. 같은 두 사람이 서로에게 동시에 대화를 열어도 둘째는
 * 첫째가 만든 대화를 찾고, 다른 기기의 탈퇴와 겹친 쓰기는 활성이 아님을 보고 그만둔다. 보내기는 같은 사람의 요청이
 * 계정 행에서 줄을 서므로 하루 한도를 세는 것과 넣는 것 사이에 끼어드는 것이 없다.
 *
 * <p>남의 표는 읽지 않는다 — 차단은 challenge 의 {@link UserBlocking} 과 게시판의 옛 차단(community)에 묻는다.
 */
@Repository
class PostgresMessageRepository implements MessageRepository {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AccountRowLock accounts;
    private final UserBlocking blocking;
    private final CommunityService community;

    PostgresMessageRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            AccountRowLock accounts,
            UserBlocking blocking,
            CommunityService community) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.accounts = accounts;
        this.blocking = blocking;
        this.community = community;
    }

    @Override
    public Started start(UUID me, UUID partner, UUID originPostId, Instant rawNow) {
        Instant now = micros(rawNow);
        return required(transaction.execute(status -> {
            Pair pair = lockPair(me, partner);
            if (!pair.active(me)) {
                throw new ApiException(403, "account_deactivated");
            }
            if (!pair.active(partner)) {
                throw new ApiException(404, "user_not_found");
            }
            requireNotBlocked(me, partner);
            List<DirectConversationEntity> existing = entityManager.createQuery("""
                            select c from DirectConversationEntity c
                            where (c.starterUserId = :me and c.recipientUserId = :partner)
                               or (c.starterUserId = :partner and c.recipientUserId = :me)
                            """, DirectConversationEntity.class)
                    .setParameter("me", me)
                    .setParameter("partner", partner)
                    .getResultList();
            if (!existing.isEmpty()) {
                return new Started(conversation(existing.getFirst(), me), false);
            }
            long opened = entityManager.createQuery("""
                            select count(c) from DirectConversationEntity c
                            where c.starterUserId = :me and c.createdAt >= :since
                            """, Long.class)
                    .setParameter("me", me)
                    .setParameter("since", MessageRules.koreanMidnight(now))
                    .getSingleResult();
            if (opened >= MessageRules.DAILY_CONVERSATIONS) {
                throw new ApiException(429, "daily_conversation_limit");
            }
            DirectConversationEntity created = new DirectConversationEntity(UUID.randomUUID(), me, partner, originPostId, now);
            entityManager.persist(created);
            entityManager.flush();
            return new Started(conversation(created, me), true);
        }));
    }

    @Override
    public Conversation conversation(UUID me, UUID conversationId) {
        return conversation(load(me, conversationId), me);
    }

    @Override
    public PageOf<Summary> conversations(UUID me, String cursor, int size) {
        MessageCursor.Cursor after = cursor == null || cursor.isBlank() ? null : decode(cursor);
        TypedQuery<DirectConversationEntity> query = entityManager.createQuery("""
                        select c from DirectConversationEntity c
                        where (c.starterUserId = :me or c.recipientUserId = :me)
                          and c.lastMessageAt is not null
                        %s
                        order by c.lastMessageAt desc, c.id desc
                        """.formatted(after == null ? "" : """
                          and (c.lastMessageAt < :at or (c.lastMessageAt = :at and c.id < :after))
                        """), DirectConversationEntity.class)
                .setParameter("me", me)
                .setMaxResults(size + 1);
        if (after != null) {
            query.setParameter("at", after.at()).setParameter("after", after.id());
        }
        List<DirectConversationEntity> rows = query.getResultList();
        boolean more = rows.size() > size;
        List<DirectConversationEntity> page = more ? rows.subList(0, size) : rows;
        if (page.isEmpty()) {
            return new PageOf<>(List.of(), null);
        }
        List<UUID> ids = page.stream().map(DirectConversationEntity::getId).toList();
        Map<UUID, Long> unread = unreadBy(me, ids);
        Map<UUID, Message> last = lastMessages(ids);
        List<Summary> items = page.stream()
                .map(row -> new Summary(conversation(row, me), last.get(row.getId()), unread.getOrDefault(row.getId(), 0L)))
                .toList();
        DirectConversationEntity tail = page.getLast();
        return new PageOf<>(items, more ? MessageCursor.encode(tail.getLastMessageAt(), tail.getId()) : null);
    }

    @Override
    public PageOf<Message> messages(UUID me, UUID conversationId, String cursor, int size) {
        // 대화를 먼저 찾고 커서를 나중에 읽는다 — "남의 대화 + 깨진 커서" 가 400 이 아니라 404 다(게시판 댓글과 같은 순서).
        load(me, conversationId);
        MessageCursor.Cursor after = cursor == null || cursor.isBlank() ? null : decode(cursor);
        TypedQuery<DirectMessageEntity> query = entityManager.createQuery("""
                        select m from DirectMessageEntity m
                        where m.conversationId = :conversation
                        %s
                        order by m.createdAt desc, m.id desc
                        """.formatted(after == null ? "" : """
                          and (m.createdAt < :at or (m.createdAt = :at and m.id < :after))
                        """), DirectMessageEntity.class)
                .setParameter("conversation", conversationId)
                .setMaxResults(size + 1);
        if (after != null) {
            query.setParameter("at", after.at()).setParameter("after", after.id());
        }
        List<DirectMessageEntity> rows = query.getResultList();
        boolean more = rows.size() > size;
        List<DirectMessageEntity> page = more ? rows.subList(0, size) : rows;
        List<Message> items = page.stream().map(PostgresMessageRepository::message).toList();
        return new PageOf<>(items, more && !page.isEmpty()
                ? MessageCursor.encode(page.getLast().getCreatedAt(), page.getLast().getId())
                : null);
    }

    @Override
    public Sent send(UUID me, UUID conversationId, UUID requestId, String fingerprint, String body, Instant rawNow) {
        Instant now = micros(rawNow);
        return required(transaction.execute(status -> {
            // 재전송 확인이 다른 판정보다 먼저다 — 응답을 잃은 재전송이 두 번째 메시지나 429·403 이 되지 않는다. 계정 행을
            // 잠근 뒤 한 번 더 본다(같은 사람의 겹친 재전송).
            Sent replayed = replay(me, requestId, fingerprint);
            if (replayed != null) {
                return replayed;
            }
            DirectConversationEntity conversation = load(me, conversationId);
            boolean starter = conversation.getStarterUserId().equals(me);
            UUID partner = starter ? conversation.getRecipientUserId() : conversation.getStarterUserId();
            Pair pair = lockPair(me, partner);
            replayed = replay(me, requestId, fingerprint);
            if (replayed != null) {
                return replayed;
            }
            if (!pair.active(me)) {
                throw new ApiException(403, "account_deactivated");
            }
            if (!pair.active(partner)) {
                throw new ApiException(403, "partner_unavailable");
            }
            requireNotBlocked(me, partner);
            long sentToday = entityManager.createQuery("""
                            select count(m) from DirectMessageEntity m
                            where m.senderUserId = :me and m.createdAt >= :since
                            """, Long.class)
                    .setParameter("me", me)
                    .setParameter("since", MessageRules.koreanMidnight(now))
                    .getSingleResult();
            if (sentToday >= MessageRules.DAILY_MESSAGES) {
                throw new ApiException(429, "daily_message_limit");
            }
            DirectMessageEntity created = new DirectMessageEntity(
                    UUID.randomUUID(), conversationId, me, body, requestId, fingerprint, now);
            entityManager.persist(created);
            entityManager.flush();
            // 보낸 사람은 자기 메시지까지 읽은 것이다.
            entityManager.createQuery(starter
                            ? "update DirectConversationEntity c set c.lastMessageAt = :now, c.starterReadAt = :now where c.id = :id"
                            : "update DirectConversationEntity c set c.lastMessageAt = :now, c.recipientReadAt = :now where c.id = :id")
                    .setParameter("now", now)
                    .setParameter("id", conversationId)
                    .executeUpdate();
            // 받는 사람의 푸시 시각을 1분이 지났을 때만 당긴다. 한 문장이라 겹친 두 보내기 가운데 하나만 푸시를 맡는다.
            int due = entityManager.createQuery(starter
                            ? """
                              update DirectConversationEntity c set c.recipientPushedAt = :now
                              where c.id = :id and (c.recipientPushedAt is null or c.recipientPushedAt <= :before)
                              """
                            : """
                              update DirectConversationEntity c set c.starterPushedAt = :now
                              where c.id = :id and (c.starterPushedAt is null or c.starterPushedAt <= :before)
                              """)
                    .setParameter("now", now)
                    .setParameter("before", now.minus(MessageRules.PUSH_GAP))
                    .setParameter("id", conversationId)
                    .executeUpdate();
            return new Sent(message(created), true, due == 1, partner);
        }));
    }

    @Override
    public void markRead(UUID me, UUID conversationId, Instant rawNow) {
        Instant now = micros(rawNow);
        transaction.executeWithoutResult(status -> {
            DirectConversationEntity conversation = load(me, conversationId);
            boolean starter = conversation.getStarterUserId().equals(me);
            // 읽은 시각은 뒤로 가지 않는다(늦게 도착한 읽음 표시가 앞선 것을 덮지 않는다).
            entityManager.createQuery(starter
                            ? """
                              update DirectConversationEntity c set c.starterReadAt = :now
                              where c.id = :id and (c.starterReadAt is null or c.starterReadAt < :now)
                              """
                            : """
                              update DirectConversationEntity c set c.recipientReadAt = :now
                              where c.id = :id and (c.recipientReadAt is null or c.recipientReadAt < :now)
                              """)
                    .setParameter("now", now)
                    .setParameter("id", conversationId)
                    .executeUpdate();
        });
    }

    @Override
    public long unreadTotal(UUID me) {
        return entityManager.createQuery("""
                        select count(m) from DirectMessageEntity m, DirectConversationEntity c
                        where c.id = m.conversationId and m.senderUserId <> :me
                          and ((c.starterUserId = :me and (c.starterReadAt is null or m.createdAt > c.starterReadAt))
                            or (c.recipientUserId = :me and (c.recipientReadAt is null or m.createdAt > c.recipientReadAt)))
                        """, Long.class)
                .setParameter("me", me)
                .getSingleResult();
    }

    private Map<UUID, Long> unreadBy(UUID me, List<UUID> ids) {
        Map<UUID, Long> result = new HashMap<>();
        entityManager.createQuery("""
                        select m.conversationId as conversationId, count(m) as unread
                        from DirectMessageEntity m, DirectConversationEntity c
                        where c.id = m.conversationId and c.id in :ids and m.senderUserId <> :me
                          and ((c.starterUserId = :me and (c.starterReadAt is null or m.createdAt > c.starterReadAt))
                            or (c.recipientUserId = :me and (c.recipientReadAt is null or m.createdAt > c.recipientReadAt)))
                        group by m.conversationId
                        """, Tuple.class)
                .setParameter("me", me)
                .setParameter("ids", ids)
                .getResultList()
                .forEach(row -> result.put(row.get("conversationId", UUID.class), row.get("unread", Long.class)));
        return result;
    }

    /** 대화마다 마지막 메시지. 같은 시각이 둘이면 id 가 큰 쪽이다. */
    private Map<UUID, Message> lastMessages(List<UUID> ids) {
        Map<UUID, Message> result = new LinkedHashMap<>();
        entityManager.createQuery("""
                        select m from DirectMessageEntity m
                        where m.conversationId in :ids
                          and m.createdAt = (select max(x.createdAt) from DirectMessageEntity x where x.conversationId = m.conversationId)
                        order by m.id desc
                        """, DirectMessageEntity.class)
                .setParameter("ids", ids)
                .getResultList()
                .forEach(row -> result.putIfAbsent(row.getConversationId(), message(row)));
        return result;
    }

    private Sent replay(UUID me, UUID requestId, String fingerprint) {
        List<DirectMessageEntity> previous = entityManager.createQuery("""
                        select m from DirectMessageEntity m where m.senderUserId = :me and m.requestId = :request
                        """, DirectMessageEntity.class)
                .setParameter("me", me)
                .setParameter("request", requestId)
                .getResultList();
        if (previous.isEmpty()) {
            return null;
        }
        DirectMessageEntity row = previous.getFirst();
        if (!fingerprint.equals(row.getRequestFingerprint().strip())) {
            throw new ApiException(422, "request_fingerprint_mismatch");
        }
        return new Sent(message(row), false, false, null);
    }

    /** 내가 참여한 대화. 아니면 없는 것과 같은 404 다. */
    private DirectConversationEntity load(UUID me, UUID conversationId) {
        List<DirectConversationEntity> rows = entityManager.createQuery("""
                        select c from DirectConversationEntity c
                        where c.id = :id and (c.starterUserId = :me or c.recipientUserId = :me)
                        """, DirectConversationEntity.class)
                .setParameter("id", conversationId)
                .setParameter("me", me)
                .getResultList();
        if (rows.isEmpty()) {
            throw new ApiException(404, "conversation_not_found");
        }
        return rows.getFirst();
    }

    /**
     * 차단이 어느 쪽으로든 있으면 403 {@code message_blocked}. 사람 차단({@code user_blocks})과 0.1.0 전 게시판 차단을 함께 본다.
     */
    private void requireNotBlocked(UUID me, UUID partner) {
        if (blocking.blockedEitherWay(me, partner) || community.legacyBlockedEitherWay(me, partner)) {
            throw new ApiException(403, "message_blocked");
        }
    }

    /** 두 계정 행을 id 순서로 잠근다. 같은 두 사람의 겹친 요청이 서로를 기다리며 멈추지 않게 순서를 고정한다. */
    private Pair lockPair(UUID me, UUID partner) {
        boolean meFirst = me.compareTo(partner) < 0;
        boolean firstActive = accounts.lockActive(meFirst ? me : partner);
        boolean secondActive = accounts.lockActive(meFirst ? partner : me);
        return new Pair(me, meFirst ? firstActive : secondActive, meFirst ? secondActive : firstActive);
    }

    private record Pair(UUID me, boolean meActive, boolean partnerActive) {
        boolean active(UUID who) {
            return who.equals(me) ? meActive : partnerActive;
        }
    }

    private static Conversation conversation(DirectConversationEntity row, UUID me) {
        boolean starter = row.getStarterUserId().equals(me);
        return new Conversation(
                row.getId(),
                row.getStarterUserId(),
                row.getRecipientUserId(),
                row.getOriginPostId(),
                starter ? row.getStarterReadAt() : row.getRecipientReadAt(),
                row.getLastMessageAt(),
                row.getCreatedAt());
    }

    private static Message message(DirectMessageEntity row) {
        return new Message(row.getId(), row.getConversationId(), row.getSenderUserId(), row.getBody(), row.getCreatedAt());
    }

    private static MessageCursor.Cursor decode(String cursor) {
        try {
            return MessageCursor.decode(cursor);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(400, "invalid_cursor", exception);
        }
    }

    /** DB 의 timestamptz 는 마이크로초까지다. 응답과 다시 읽은 값이 같도록 미리 자른다. */
    private static Instant micros(Instant now) {
        return now.truncatedTo(ChronoUnit.MICROS);
    }

    private static <T> T required(T value) {
        return Objects.requireNonNull(value, "transaction returned no value");
    }
}
