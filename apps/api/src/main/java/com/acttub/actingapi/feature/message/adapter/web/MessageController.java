package com.acttub.actingapi.feature.message.adapter.web;

import static com.acttub.actingapi.feature.message.adapter.web.MessageDtos.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.message.app.MessageService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 배우끼리 1:1 메시지의 HTTP 문 (docs/specs/community/messages.md, SOMA-1039).
 *
 * <p>게시판처럼 회원 전용이다. 게이트(동의·프로필)를 지난 회원만 되고 게스트는 403 {@code member_only} — 이 경로는 어느
 * {@code GuestFeature} 에도 들지 않는다. 차단은 게시판의 차단 걸기({@code POST /v2/community/blocks})를 그대로 쓴다.
 */
@RestController
@RequestMapping(value = "/v2/messages", produces = MediaType.APPLICATION_JSON_VALUE)
class MessageController {
    private static final String TAG = "v2-messages";

    private final MessageService messages;
    private final AccessGate auth;

    MessageController(MessageService messages, AccessGate auth) {
        this.messages = messages;
        this.auth = auth;
    }

    @Operation(
            summary = "Start Direct Conversation",
            description = """
                    게시판 글·댓글의 작성자와 대화를 연다. 방향과 무관하게 두 사람의 대화가 이미 있으면 그 대화를 200 으로 준다(한도를 \
                    세지 않는다). 새 대화는 201 이고 하루 20개까지다(429 daily_conversation_limit). 자기 자신 400 cannot_message_self, \
                    없거나 게스트·탈퇴한 상대 404 user_not_found, 보이지 않는 글 404 post_not_found, 어느 쪽이든 차단했으면 403 \
                    message_blocked.""",
            operationId = "start_conversation_v2_messages_conversations_post",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created",
            content = @Content(schema = @Schema(implementation = ConversationPayload.class)))
    @ApiResponse(responseCode = "200", description = "Existing",
            content = @Content(schema = @Schema(implementation = ConversationPayload.class)))
    @PostMapping(value = "/conversations", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<ConversationPayload> start(@Valid @RequestBody StartRequest body, HttpServletRequest request) {
        MessageService.StartResult result = messages.start(member(request), body.userId(), body.postId());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(ConversationPayload.of(result.conversation()));
    }

    @Operation(
            summary = "List Direct Conversations",
            description = "메시지가 하나라도 있는 내 대화, 마지막 메시지가 최근인 것부터. 깨진 커서 400 invalid_cursor.",
            operationId = "list_conversations_v2_messages_conversations_get",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConversationListResponse.class)))
    @GetMapping("/conversations")
    ConversationListResponse conversations(
            @Parameter(schema = @Schema(nullable = true)) @RequestParam(required = false) String cursor,
            // type 을 적지 않으면 @Schema 가 파라미터 타입을 덮어써 string 으로 문서화된다(게시판과 같은 선언).
            @Parameter(schema = @Schema(type = "integer", nullable = true, minimum = "1", maximum = "50",
                    exclusiveMinimum = false, exclusiveMaximum = false))
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request) {
        UUID me = member(request);
        validateLimit(limit);
        MessageService.SummaryPage page = messages.conversations(me, cursor, limit);
        return new ConversationListResponse(page.conversations().stream().map(SummaryPayload::of).toList(), page.nextCursor());
    }

    @Operation(
            summary = "Get Direct Conversation",
            description = "대화방 머리(상대, 시작 글, 보낼 수 있는지). 참여자가 아니면 404 conversation_not_found.",
            operationId = "get_conversation_v2_messages_conversations__conversation_id__get",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConversationPayload.class)))
    @GetMapping("/conversations/{conversation_id}")
    ConversationPayload conversation(@PathVariable("conversation_id") UUID conversationId, HttpServletRequest request) {
        return ConversationPayload.of(messages.conversation(member(request), conversationId));
    }

    @Operation(
            summary = "List Direct Messages",
            description = "대화의 메시지, 최근 것부터. next_cursor 로 더 옛 것을 읽는다. 참여자가 아니면 404 conversation_not_found.",
            operationId = "list_messages_v2_messages_conversations__conversation_id__messages_get",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = MessageListResponse.class)))
    @GetMapping("/conversations/{conversation_id}/messages")
    MessageListResponse messages(
            @PathVariable("conversation_id") UUID conversationId,
            @Parameter(schema = @Schema(nullable = true)) @RequestParam(required = false) String cursor,
            @Parameter(schema = @Schema(type = "integer", nullable = true, minimum = "1", maximum = "50",
                    exclusiveMinimum = false, exclusiveMaximum = false))
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request) {
        UUID me = member(request);
        validateLimit(limit);
        MessageService.MessagePage page = messages.messages(me, conversationId, cursor, limit);
        return new MessageListResponse(page.messages().stream().map(MessagePayload::of).toList(), page.nextCursor());
    }

    @Operation(
            summary = "Send Direct Message",
            description = """
                    글자만 보낸다(앞뒤 공백을 걷고 1~1000자). 하루 300개(429 daily_message_limit). 같은 request_id·같은 본문은 같은 \
                    메시지(200), 다른 본문은 422 request_fingerprint_mismatch. 상대가 탈퇴했으면 403 partner_unavailable, 어느 쪽이든 \
                    차단했으면 403 message_blocked. 받는 사람에게 푸시가 간다(같은 대화는 1분에 한 번).""",
            operationId = "send_message_v2_messages_conversations__conversation_id__messages_post",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "201", description = "Created",
            content = @Content(schema = @Schema(implementation = MessagePayload.class)))
    @ApiResponse(responseCode = "200", description = "Replay",
            content = @Content(schema = @Schema(implementation = MessagePayload.class)))
    @PostMapping(value = "/conversations/{conversation_id}/messages", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<MessagePayload> send(
            @PathVariable("conversation_id") UUID conversationId,
            @Valid @RequestBody SendRequest body,
            HttpServletRequest request) {
        MessageService.SendResult result = messages.send(member(request), conversationId, body.requestId(), body.body());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(MessagePayload.of(result.message()));
    }

    @Operation(
            summary = "Mark Direct Conversation Read",
            description = "지금까지 온 메시지를 읽은 것으로 둔다. 다시 불러도 같다. 참여자가 아니면 404 conversation_not_found.",
            operationId = "mark_read_v2_messages_conversations__conversation_id__read_post",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @PostMapping("/conversations/{conversation_id}/read")
    ResponseEntity<Void> markRead(@PathVariable("conversation_id") UUID conversationId, HttpServletRequest request) {
        messages.markRead(member(request), conversationId);
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Report Direct Conversation",
            description = """
                    대화(상대)를 신고한다. 게시판 신고와 같은 사유를 받고 운영 채널에 알린다. 같은 대화를 다시 신고하면 409 \
                    already_reported. 참여자가 아니면 404 conversation_not_found.""",
            operationId = "report_conversation_v2_messages_conversations__conversation_id__reports_post",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @PostMapping(value = "/conversations/{conversation_id}/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Void> report(
            @PathVariable("conversation_id") UUID conversationId,
            @Valid @RequestBody ReportRequest body,
            HttpServletRequest request) {
        messages.report(member(request), conversationId, body.reason(), body.detail());
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Count Unread Direct Messages",
            description = "내 모든 대화에서 상대가 보냈고 아직 읽지 않은 메시지 수(프로필 탭의 「메시지」 배지).",
            operationId = "unread_count_v2_messages_unread_count_get",
            tags = TAG,
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = UnreadCountResponse.class)))
    @GetMapping("/unread-count")
    UnreadCountResponse unreadCount(HttpServletRequest request) {
        return new UnreadCountResponse(Math.toIntExact(messages.unreadTotal(member(request))));
    }

    /** 게이트(동의·프로필)를 지난 회원. 게스트는 게이트가 403 {@code member_only} 로 막는다. */
    private UUID member(HttpServletRequest request) {
        return auth.gatedUser(request).id();
    }

    private static void validateLimit(Integer limit) {
        if (limit == null) {
            return;
        }
        if (limit < 1) {
            throw validationError("greater_than_equal", "Input should be greater than or equal to 1", limit, Map.of("ge", 1));
        }
        if (limit > 50) {
            throw validationError("less_than_equal", "Input should be less than or equal to 50", limit, Map.of("le", 50));
        }
    }

    private static ApiValidationException validationError(
            String type, String message, Object input, Map<String, Object> context) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", List.of("query", "limit"));
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", context);
        return new ApiValidationException(List.of(error));
    }
}
