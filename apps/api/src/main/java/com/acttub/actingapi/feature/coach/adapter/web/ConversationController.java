package com.acttub.actingapi.feature.coach.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.ConversationResponse;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.ReplyRequest;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.StartRequest;
import com.acttub.actingapi.feature.coach.adapter.web.ConversationDtos.TurnResultResponse;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 1.0.0 코치 대화 (practice.coach, practice.note). 회차에 대화는 하나이고 열린 대화는 같은 id 로 재개한다.
 *
 * <p>값의 모양(필수·300자)은 여기서 422 배열로, 규칙(분석 상태·충돌·종료·지문)은 서비스가 사유 코드 하나로
 * 답한다(CONTRACT §6-2). <b>코치의 행동 규칙은 바뀌지 않았다</b> — 저장만 새 표로 옮겼다(ADR-027, §7·§8).
 */
@RestController
@RequestMapping("/v2/coach")
class ConversationController {
    private final ConversationService conversations;
    private final AccessGate auth;

    ConversationController(ConversationService conversations, AccessGate auth) {
        this.conversations = conversations;
        this.auth = auth;
    }

    @Operation(
            summary = "Start Coach Conversation",
            description = """
                    분석이 끝난 회차에서 대화를 연다. 같은 요청 id 의 재전송과 이미 열린 대화는 같은 대화를 돌려주고,
                    분석이 아직이면 409 analysis_not_ready, 닫힌 대화가 있으면 409 conversation_closed 다(다시 코칭하려면
                    새 회차다).""",
            operationId = "start_coach_conversation_v2_coach_start_post",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = TurnResultResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/start")
    TurnResultResponse start(@Valid @RequestBody StartRequest body, HttpServletRequest request) {
        return TurnResultResponse.of(conversations.start(
                auth.gatedUser(request).id(), body.practiceId(), body.requestId()));
    }

    @Operation(
            summary = "Reply To Coach",
            description = """
                    대화를 한 턴 잇는다. 같은 요청 id·같은 본문의 재전송은 그 요청이 만든 코치 응답·종료·노트 결과를
                    그대로 돌려주고, 다른 본문이면 422 request_fingerprint_mismatch 다. revision 이 다르면 409
                    conversation_conflict(화면은 입력을 보존한 채 대화를 다시 읽는다), 닫힌 대화면 409
                    conversation_closed. 답은 300자까지이고 "그만"이라고 쓰면 마친다.""",
            operationId = "reply_to_coach_v2_coach_reply_post",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = TurnResultResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/reply")
    TurnResultResponse reply(@Valid @RequestBody ReplyRequest body, HttpServletRequest request) {
        return TurnResultResponse.of(conversations.reply(
                auth.gatedUser(request).id(), body.conversationId(), body.requestId(), body.text(), body.revision()));
    }

    @Operation(
            summary = "Get Coach Conversation",
            description = """
                    대화 하나를 턴과 함께. 409 conversation_conflict 뒤 화면이 최신 revision·status·turns 를 다시 읽는
                    자리이고, 회차 상세의 이전 대화를 펼칠 때도 쓴다. 없는 것과 남의 것은 같은 404.""",
            operationId = "get_coach_conversation_v2_coach_conversations__conversation_id__get",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ConversationResponse.class)))
    @GetMapping("/conversations/{conversation_id}")
    ConversationResponse conversation(
            @PathVariable("conversation_id") UUID conversationId, HttpServletRequest request) {
        var view = conversations.conversation(auth.gatedUser(request).id(), conversationId);
        return ConversationResponse.of(view, ConversationService.LEGACY_REPLY_LIMIT);
    }

}
