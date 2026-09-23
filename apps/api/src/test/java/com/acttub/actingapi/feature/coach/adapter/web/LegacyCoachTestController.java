package com.acttub.actingapi.feature.coach.adapter.web;

import org.springframework.boot.test.context.TestComponent;

import com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachConfirmReq;
import com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachConfirmResponse;
import com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachReplyReq;
import com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachStartReq;
import com.acttub.actingapi.feature.coach.adapter.web.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.feature.coach.app.CoachCommands.ActorMessage;
import com.acttub.actingapi.feature.coach.app.CoachCommands.CoachStart;
import com.acttub.actingapi.feature.coach.app.CoachCommands.HandoffDecision;
import com.acttub.actingapi.feature.coach.app.CoachPayload;
import com.acttub.actingapi.feature.coach.app.CoachService;
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
/** 이전 저장 계약의 회귀 검사용 어댑터. 운영 jar에는 포함되지 않고 명시적으로 import한 테스트에서만 열린다. */
@TestComponent
@org.springframework.context.annotation.Profile("legacy-practice-test")
@RestController
/*
 * ⚠ <b>옛 연습 흐름의 코치다.</b> 1.0.0 회차의 대화는 {@code ConversationController}(=`/v2/coach/*`)가 맡고,
 * 이 컨트롤러는 옛 `practice_sessions` 를 쓰는 화면이 남아 있는 동안만 `/v2/legacy-coach/*` 로 산다.
 * 옛 흐름(업로드·연습 세션·리포트)을 내릴 때 함께 사라진다(CONTRACT §6-15).
 */
@RequestMapping("/v2/legacy-coach")
public class LegacyCoachTestController {

    private final CoachService coach;
    private final CanonicalJsonResponse responses;
    private final AccessGate auth;

    LegacyCoachTestController(
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
        var user = auth.gatedUser(request);
        CoachPayload payload = coach.start(
                user.id(),
                new CoachStart(req.practiceSessionId(), req.restart()),
                requestIdHeader, request.getHeader("X-Acttub-Contract"));
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
        var user = auth.gatedUser(request);
        CoachPayload payload = coach.reply(
                user.id(),
                new ActorMessage(req.sessionId(), req.text()),
                requestIdHeader, request.getHeader("X-Acttub-Contract"));
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
        var user = auth.gatedUser(request);
        CoachPayload payload = coach.confirm(
                user.id(),
                new HandoffDecision(req.coachSessionId(), req.confirmed(), req.rebuttalText()),
                requestIdHeader, request.getHeader("X-Acttub-Contract"));
        return responses.ok(payload.body(), payload.requestId());
    }
}
