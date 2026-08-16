package com.acttub.actingapi.coach.adapter.web;

import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachConfirmReq;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachConfirmResponse;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachReplyReq;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachStartReq;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.coach.app.CoachCommands.ActorMessage;
import com.acttub.actingapi.coach.app.CoachCommands.CoachStart;
import com.acttub.actingapi.coach.app.CoachCommands.HandoffDecision;
import com.acttub.actingapi.coach.app.CoachPayload;
import com.acttub.actingapi.coach.app.CoachService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.CanonicalJsonResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Python {@code acting_api.coaching}의 공개 코칭 흐름. */
@RestController
@RequestMapping("/v2/coach")
class CoachController {

    private final CoachService coach;
    private final CanonicalJsonResponse responses;
    private final AccessGate auth;

    CoachController(
            CoachService coach,
            CanonicalJsonResponse responses,
            AccessGate auth) {
        this.coach = coach;
        this.responses = responses;
        this.auth = auth;
    }

    @Operation(
            summary = "Coach Start",
            operationId = "coach_start_v2_coach_start_post",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CoachTurnResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/start")
    ResponseEntity<byte[]> start(
            @Valid @RequestBody CoachStartReq req,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        CoachPayload payload = coach.start(
                user.id(),
                new CoachStart(req.practiceSessionId(), req.restart()),
                requestIdHeader);
        return responses.ok(payload.body(), payload.requestId());
    }

    @Operation(
            summary = "Coach Reply",
            operationId = "coach_reply_v2_coach_reply_post",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CoachTurnResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/reply")
    ResponseEntity<byte[]> reply(
            @Valid @RequestBody CoachReplyReq req,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        CoachPayload payload = coach.reply(
                user.id(),
                new ActorMessage(req.sessionId(), req.text()),
                requestIdHeader);
        return responses.ok(payload.body(), payload.requestId());
    }

    @Operation(
            summary = "Coach Confirm",
            operationId = "coach_confirm_v2_coach_confirm_post",
            tags = "v2-coach",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CoachConfirmResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/confirm")
    ResponseEntity<byte[]> confirm(
            @Valid @RequestBody CoachConfirmReq req,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        CoachPayload payload = coach.confirm(
                user.id(),
                new HandoffDecision(req.coachSessionId(), req.confirmed(), req.rebuttalText()),
                requestIdHeader);
        return responses.ok(payload.body(), payload.requestId());
    }
}
