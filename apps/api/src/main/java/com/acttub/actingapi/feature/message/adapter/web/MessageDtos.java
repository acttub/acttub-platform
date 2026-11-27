package com.acttub.actingapi.feature.message.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.message.app.MessageService;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.annotation.JsonNaming;

final class MessageDtos {
    private MessageDtos() {
    }

    @Schema(name = "StartDirectConversationRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StartRequest(
            @NotNull @Schema(description = "대화 상대(게시판 글·댓글의 작성자)") UUID userId,
            @Schema(nullable = true, description = "대화를 연 게시판 글. 새 대화일 때만 남고 대화방 머리에 제목 한 줄로 보인다")
            UUID postId) {
    }

    @Schema(name = "SendDirectMessageRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SendRequest(
            @NotNull UUID requestId,
            @NotNull @Schema(description = "앞뒤 공백을 걷고 1~1000자(코드 포인트). 글자만이다") String body) {
    }

    @Schema(name = "DirectConversationReportRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReportRequest(
            @NotNull @Schema(allowableValues = {
                    "copyright", "inappropriate", "spam", "duplicate", "other", "abuse", "sexual", "privacy"})
            String reason,
            @Schema(nullable = true, maxLength = 500) String detail) {
    }

    @Schema(name = "DirectConversationPartner", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PartnerPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    description = "공개 이름(게시판과 같다, 없으면 \"배우\"). 탈퇴했으면 \"탈퇴한 사용자\"") String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "프로필 사진을 볼 짧은 주소(1시간). 없거나 탈퇴했으면 null") String photoUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean withdrawn) {
        static PartnerPayload of(MessageService.Partner partner) {
            return new PartnerPayload(partner.id(), partner.name(), partner.photoUrl(), partner.withdrawn());
        }
    }

    @Schema(name = "DirectConversationOriginPost", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record OriginPostPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title) {
    }

    @Schema(name = "DirectConversationPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConversationPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) PartnerPayload partner,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "대화를 연 게시판 글. 없거나 지금 보이지 않으면(지움·가림·차단) null")
            OriginPostPayload originPost,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean canSend,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"partner_unavailable", "message_blocked"},
                    description = "보낼 수 없는 까닭. 상대가 탈퇴했으면 partner_unavailable, 어느 쪽이든 차단했으면 message_blocked")
            String unavailableReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant lastMessageAt) {
        static ConversationPayload of(MessageService.ConversationView view) {
            return new ConversationPayload(
                    view.id(),
                    PartnerPayload.of(view.partner()),
                    view.originPost() == null ? null : new OriginPostPayload(view.originPost().id(), view.originPost().title()),
                    view.canSend(),
                    view.unavailableReason(),
                    view.createdAt(),
                    view.lastMessageAt());
        }
    }

    @Schema(name = "DirectLastMessage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LastMessagePayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "본문 앞 80자") String preview,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt) {
    }

    @Schema(name = "DirectConversationSummary", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SummaryPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) PartnerPayload partner,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) LastMessagePayload lastMessage,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "상대가 보냈고 내가 아직 읽지 않은 수") int unreadCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant lastMessageAt) {
        static SummaryPayload of(MessageService.SummaryView view) {
            return new SummaryPayload(
                    view.id(),
                    PartnerPayload.of(view.partner()),
                    view.lastMessage() == null ? null : new LastMessagePayload(
                            view.lastMessage().preview(), view.lastMessage().mine(), view.lastMessage().createdAt()),
                    Math.toIntExact(view.unreadCount()),
                    view.lastMessageAt());
        }
    }

    @Schema(name = "DirectConversationListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConversationListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<SummaryPayload> conversations,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nextCursor) {
    }

    @Schema(name = "DirectMessagePayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MessagePayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID conversationId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt) {
        static MessagePayload of(MessageService.MessageView view) {
            return new MessagePayload(view.id(), view.conversationId(), view.body(), view.mine(), view.createdAt());
        }
    }

    @Schema(name = "DirectMessageListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MessageListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "최근 것부터") List<MessagePayload> messages,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "더 옛 메시지를 읽을 커서")
            String nextCursor) {
    }

    @Schema(name = "DirectUnreadCountResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UnreadCountResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int unreadCount) {
    }
}
