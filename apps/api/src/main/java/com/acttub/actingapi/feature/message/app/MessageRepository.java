package com.acttub.actingapi.feature.message.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 메시지가 저장소에 요구하는 것. 구현은 {@code adapter/db/PostgresMessageRepository} 하나다.
 *
 * <p><b>트랜잭션과 잠금이 구현 안에 있다.</b> 대화 시작과 보내기는 두 사람의 계정 행을 id 순서로 잠근 뒤(탈퇴와 겹친 쓰기,
 * 서로에게 동시에 여는 대화, 하루 한도 세기) 차단·한도를 보고 쓴다. 그 판정이 한 트랜잭션 안에 있어야 하므로 이 Port 가
 * 오류 응답(403·404·429)까지 정한다.
 *
 * <p>보는 사람이 인자로 따라다닌다. 참여자가 아닌 대화는 없는 것과 같은 404 {@code conversation_not_found} 다.
 */
public interface MessageRepository {

    /**
     * 두 사람의 대화를 찾거나 연다. 방향과 무관하게 이미 있으면 그 대화다(한도를 세지 않는다).
     *
     * @param originPostId 대화를 연 게시판 글. 새 대화일 때만 남는다
     */
    Started start(UUID me, UUID partner, UUID originPostId, Instant now);

    /** 내 대화 하나. 참여자가 아니면 404. */
    Conversation conversation(UUID me, UUID conversationId);

    /** 메시지가 하나라도 있는 내 대화, 마지막 메시지가 최근인 것부터. */
    PageOf<Summary> conversations(UUID me, String cursor, int size);

    /** 대화의 메시지, 최근 것부터. 참여자가 아니면 404. */
    PageOf<Message> messages(UUID me, UUID conversationId, String cursor, int size);

    /**
     * 보낸다. 같은 {@code requestId} 의 재전송은 다른 판정보다 먼저 처음 메시지를 돌려준다(본문 지문이 다르면 422).
     */
    Sent send(UUID me, UUID conversationId, UUID requestId, String fingerprint, String body, Instant now);

    /** 내가 이 대화를 {@code now} 까지 읽었다. 참여자가 아니면 404. */
    void markRead(UUID me, UUID conversationId, Instant now);

    /** 내 모든 대화에서 상대가 보냈고 아직 읽지 않은 메시지 수. */
    long unreadTotal(UUID me);

    /**
     * @param starterId 먼저 연 사람
     * @param myReadAt 보는 사람이 마지막으로 읽은 시각(없으면 {@code null})
     */
    record Conversation(UUID id, UUID starterId, UUID recipientId, UUID originPostId, Instant myReadAt,
            Instant lastMessageAt, Instant createdAt) {

        public UUID partnerOf(UUID me) {
            return starterId.equals(me) ? recipientId : starterId;
        }
    }

    record Message(UUID id, UUID conversationId, UUID senderId, String body, Instant createdAt) {
    }

    /** 목록의 한 줄. {@code last} 는 마지막 메시지다. */
    record Summary(Conversation conversation, Message last, long unread) {
    }

    record Started(Conversation conversation, boolean created) {
    }

    /** @param pushDue 받는 사람에게 푸시를 보낼 차례인가(같은 대화는 1분에 한 번) */
    record Sent(Message message, boolean created, boolean pushDue, UUID recipientId) {
    }

    record PageOf<T>(List<T> items, String nextCursor) {
    }
}
