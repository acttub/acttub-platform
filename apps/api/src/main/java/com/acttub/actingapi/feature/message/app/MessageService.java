package com.acttub.actingapi.feature.message.app;

import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.UserBlocking;
import com.acttub.actingapi.feature.community.app.CommunityService;
import com.acttub.actingapi.feature.message.app.MessageRepository.Conversation;
import com.acttub.actingapi.feature.message.app.MessageRepository.Message;
import com.acttub.actingapi.feature.message.app.MessageRepository.PageOf;
import com.acttub.actingapi.feature.message.app.MessageRepository.Sent;
import com.acttub.actingapi.feature.message.app.MessageRepository.Started;
import com.acttub.actingapi.feature.message.app.MessageRepository.Summary;
import com.acttub.actingapi.feature.message.domain.MessageRules;
import com.acttub.actingapi.feature.push.app.PushService;
import com.acttub.actingapi.platform.text.InputCharset;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.acttub.actingapi.platform.web.Hashing;
import org.springframework.stereotype.Service;

/**
 * 배우끼리 1:1 메시지의 규칙 (docs/specs/community/messages.md, SOMA-1039).
 *
 * <p>모양 검사(자기 자신, 본문 길이·글자, 신고 사유)와 응답 조립이 여기 있고, 잠금이 필요한 판정(탈퇴·차단·한도·재전송)은
 * 저장소가 한 트랜잭션 안에서 한다. 이름·사진은 profile 이({@link MessagePeople}), 시작 글의 제목과 신고 기록은 게시판이,
 * 차단은 챌린지와 함께 쓰는 {@code user_blocks} 가 맡는다.
 *
 * <p>푸시는 저장소가 커밋한 뒤에 보낸다. 실패해도 보내기는 그대로다({@link PushService} 가 밖으로 던지지 않는다).
 */
@Service
public class MessageService {
    /** 게시판 신고와 같은 사유다(community.README 「규칙·제약」). */
    static final Set<String> REPORT_REASONS = Set.of(
            "copyright", "inappropriate", "spam", "duplicate", "other", "abuse", "sexual", "privacy");

    private final MessageRepository messages;
    private final MessagePeople people;
    private final CommunityService community;
    private final UserBlocking blocking;
    private final PushService push;
    private final CanonicalJson canonical;
    private final Clock clock;

    public MessageService(MessageRepository messages, MessagePeople people, CommunityService community,
            UserBlocking blocking, PushService push, CanonicalJson canonical, Clock clock) {
        this.messages = messages;
        this.people = people;
        this.community = community;
        this.blocking = blocking;
        this.push = push;
        this.canonical = canonical;
        this.clock = clock;
    }

    /**
     * 대화를 찾거나 연다. 자기 자신 400, 없거나 게스트·탈퇴한 상대 404 {@code user_not_found}, 보이지 않는 시작 글 404
     * {@code post_not_found}. 차단·하루 한도·탈퇴와 겹친 쓰기는 저장소가 본다.
     */
    public StartResult start(UUID me, UUID partnerId, UUID originPostId) {
        if (me.equals(partnerId)) {
            throw new ApiException(400, "cannot_message_self");
        }
        MessagePeople.Person partner = people.find(partnerId);
        if (partner == null || !partner.member() || !partner.active()) {
            throw new ApiException(404, "user_not_found");
        }
        if (originPostId != null && community.postHeadline(originPostId, me).isEmpty()) {
            throw new ApiException(404, "post_not_found");
        }
        Started started = messages.start(me, partnerId, originPostId, clock.instant());
        return new StartResult(detail(me, started.conversation()), started.created());
    }

    public ConversationView conversation(UUID me, UUID conversationId) {
        return detail(me, messages.conversation(me, conversationId));
    }

    public SummaryPage conversations(UUID me, String cursor, Integer limit) {
        PageOf<Summary> page = messages.conversations(me, cursor, MessageRules.pageSize(limit));
        return new SummaryPage(page.items().stream().map(row -> summary(me, row)).toList(), page.nextCursor());
    }

    public MessagePage messages(UUID me, UUID conversationId, String cursor, Integer limit) {
        PageOf<Message> page = messages.messages(me, conversationId, cursor, MessageRules.pageSize(limit));
        return new MessagePage(page.items().stream().map(row -> view(me, row)).toList(), page.nextCursor());
    }

    /** 보낸다. 본문은 앞뒤 공백을 걷은 1~1000자이고 읽을 수 없는 글자 묶음은 400 {@code unreadable_text} 다. */
    public SendResult send(UUID me, UUID conversationId, UUID requestId, String rawBody) {
        InputCharset.require(rawBody);
        String body = MessageRules.trim(rawBody);
        if (!MessageRules.bodyLength(body)) {
            throw ApiValidationException.valueError(List.of("body", "body"), "Value error, invalid length", rawBody);
        }
        String fingerprint = Hashing.sha256Hex(canonical.bytes(Arrays.asList(conversationId.toString(), body)));
        Sent sent = messages.send(me, conversationId, requestId, fingerprint, body, clock.instant());
        if (sent.pushDue()) {
            MessagePeople.Person sender = people.find(me);
            push.onDirectMessage(sent.recipientId(), conversationId,
                    MessageRules.displayName(sender == null ? null : sender.name(), false));
        }
        return new SendResult(view(me, sent.message()), sent.created());
    }

    public void markRead(UUID me, UUID conversationId) {
        messages.markRead(me, conversationId, clock.instant());
    }

    public long unreadTotal(UUID me) {
        return messages.unreadTotal(me);
    }

    /**
     * 대화(상대)를 신고한다. 게시판 신고 표에 {@code conversation} 대상으로 남기고 팀에 알린다. 같은 대화를 다시 신고하면 409
     * {@code already_reported}(게시판이 판정한다).
     */
    public void report(UUID me, UUID conversationId, String reason, String rawDetail) {
        if (!REPORT_REASONS.contains(reason)) {
            throw ApiValidationException.valueError(List.of("body", "reason"), "Value error, invalid reason", reason);
        }
        InputCharset.require(rawDetail);
        String detail = MessageRules.trim(rawDetail);
        if (detail != null && detail.codePointCount(0, detail.length()) > MessageRules.REPORT_DETAIL_MAX) {
            throw ApiValidationException.valueError(List.of("body", "detail"), "Value error, invalid length", rawDetail);
        }
        Conversation conversation = messages.conversation(me, conversationId);
        community.fileConversationReport(me, conversation.id(), reason, detail == null || detail.isEmpty() ? null : detail);
    }

    private ConversationView detail(UUID me, Conversation conversation) {
        UUID partnerId = conversation.partnerOf(me);
        MessagePeople.Person person = people.find(partnerId);
        Partner partner = partner(partnerId, person);
        OriginPost origin = conversation.originPostId() == null ? null : community.postHeadline(conversation.originPostId(), me)
                .map(headline -> new OriginPost(headline.id(), headline.title()))
                .orElse(null);
        boolean blocked = blocking.blockedEitherWay(me, partnerId) || community.legacyBlockedEitherWay(me, partnerId);
        String unavailable = partner.withdrawn() ? "partner_unavailable" : blocked ? "message_blocked" : null;
        return new ConversationView(conversation.id(), partner, origin, unavailable == null, unavailable,
                conversation.createdAt(), conversation.lastMessageAt());
    }

    private SummaryView summary(UUID me, Summary row) {
        UUID partnerId = row.conversation().partnerOf(me);
        Message last = row.last();
        return new SummaryView(
                row.conversation().id(),
                partner(partnerId, people.find(partnerId)),
                last == null ? null : new LastMessage(MessageRules.preview(last.body()), me.equals(last.senderId()), last.createdAt()),
                row.unread(),
                row.conversation().lastMessageAt());
    }

    private static Partner partner(UUID partnerId, MessagePeople.Person person) {
        boolean withdrawn = person == null || !person.active();
        return new Partner(
                partnerId,
                MessageRules.displayName(person == null ? null : person.name(), withdrawn),
                withdrawn || person == null ? null : person.photoUrl(),
                withdrawn);
    }

    private static MessageView view(UUID me, Message message) {
        return new MessageView(message.id(), message.conversationId(), message.body(), me.equals(message.senderId()),
                message.createdAt());
    }

    /** @param withdrawn 상대가 탈퇴했다. 이름은 "탈퇴한 사용자"이고 사진은 없다 */
    public record Partner(UUID id, String name, String photoUrl, boolean withdrawn) {
    }

    public record OriginPost(UUID id, String title) {
    }

    /**
     * @param originPost 대화를 연 글. 없거나 지금 보는 사람에게 보이지 않으면 {@code null}
     * @param canSend 지금 보낼 수 있는가
     * @param unavailableReason 보낼 수 없는 까닭({@code partner_unavailable}·{@code message_blocked}), 보낼 수 있으면 {@code null}
     */
    public record ConversationView(UUID id, Partner partner, OriginPost originPost, boolean canSend,
            String unavailableReason, Instant createdAt, Instant lastMessageAt) {
    }

    public record LastMessage(String preview, boolean mine, Instant createdAt) {
    }

    public record SummaryView(UUID id, Partner partner, LastMessage lastMessage, long unreadCount, Instant lastMessageAt) {
    }

    public record MessageView(UUID id, UUID conversationId, String body, boolean mine, Instant createdAt) {
    }

    public record StartResult(ConversationView conversation, boolean created) {
    }

    public record SendResult(MessageView message, boolean created) {
    }

    public record SummaryPage(List<SummaryView> conversations, String nextCursor) {
    }

    public record MessagePage(List<MessageView> messages, String nextCursor) {
    }
}
