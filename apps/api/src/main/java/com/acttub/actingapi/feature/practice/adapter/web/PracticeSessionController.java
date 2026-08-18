package com.acttub.actingapi.feature.practice.adapter.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.ObservationPackResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionAcceptedResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionCreateResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionDetail;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionListItem;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionListResponse;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionRequest;
import com.acttub.actingapi.feature.practice.adapter.web.PracticeSessionDtos.PracticeSessionStatusResponse;
import com.acttub.actingapi.feature.practice.app.AnalysisOutcome;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.acttub.actingapi.feature.practice.app.NewPracticeSession;
import com.acttub.actingapi.feature.practice.app.PlayableSession;
import com.acttub.actingapi.feature.practice.app.PracticeSessionService;
import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.BlockageBranch;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /v2/practice-sessions} 의 HTTP 표면. 여기 있는 것은 전부 표기의 문제다 — 누가 보냈는지,
 * 무엇으로 왔는지, 어떤 코드와 바이트로 나가는지.
 *
 * <p>규칙은 {@link PracticeSessionService} 에 있다. 이 파일이 400 줄이던 시절에는 둘이 같은
 * 메서드 안에 섞여 있어, 규칙 하나를 고치려면 요청 파싱과 응답 조립을 함께 헤집어야 했다.
 */
@RestController
@RequestMapping("/v2/practice-sessions")
class PracticeSessionController {

    private final PracticeSessionService sessions;
    private final AccessGate auth;
    private final CanonicalJson canonical;

    PracticeSessionController(
            PracticeSessionService sessions,
            AccessGate auth,
            CanonicalJson canonical) {
        this.sessions = sessions;
        this.auth = auth;
        this.canonical = canonical;
    }

    @Operation(
            summary = "Create Session",
            operationId = "create_session_v2_practice_sessions_post",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeSessionCreateResponse.class))),
        @ApiResponse(
                responseCode = "202",
                description = "Accepted",
                content = @Content(schema = @Schema(implementation = PracticeSessionAcceptedResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping
    ResponseEntity<byte[]> create(
            @Valid @RequestBody PracticeSessionRequest body,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        validateLiteral("blockage_kind", body.blockageKind(), BlockageBranch.KINDS);
        validateLiteral("sub_branch", body.subBranch(), BlockageBranch.SUB_BRANCHES);
        UUID requestId = requestId(requestIdHeader);
        NewPracticeSession command = new NewPracticeSession(
                body.uploadIntentId(),
                body.situation(),
                body.characterContext(),
                body.goal(),
                body.blockageKind(),
                body.subBranch(),
                body.blockageDetail(),
                body.continuedFrom());
        return json(sessions.create(user.id(), command, requestId), requestId);
    }

    @Operation(
            summary = "List Sessions",
            operationId = "list_sessions_v2_practice_sessions_get",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = PracticeSessionListResponse.class)))
    @GetMapping
    PracticeSessionListResponse list(HttpServletRequest request) {
        var user = auth.consentedUser(request);
        return new PracticeSessionListResponse(sessions.list(user.id()).stream()
                .map(PracticeSessionController::listItem)
                .toList());
    }

    @Operation(
            summary = "Get Session Status",
            operationId = "get_session_status_v2_practice_sessions__session_id__status_get",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeSessionStatusResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/{session_id}/status")
    PracticeSessionStatusResponse status(
            @PathVariable("session_id") UUID sessionId,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        AnalysisStatus status = sessions.status(user.id(), sessionId);
        return new PracticeSessionStatusResponse(status.status(), status.errorCode());
    }

    /**
     * 상세.
     *
     * <p>레코드가 아니라 {@code Map} 을 돌려주는 이유는 <b>키의 유무가 상태에 따라 달라지기</b>
     * 때문이다 — 요약은 분석이 끝났을 때만, 오류 코드는 실패했을 때만 실린다. 레코드로 내면
     * Jackson 이 항상 모든 필드를 실어, 파이썬이 내지 않던 키가 붙는다. 응답 형태의 선언은
     * {@link PracticeSessionDetail} 이 맡아 OpenAPI 로 나간다.
     */
    @Operation(
            summary = "Get Session",
            operationId = "get_session_v2_practice_sessions__session_id__get",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeSessionDetail.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/{session_id}")
    Map<String, Object> detail(
            @PathVariable("session_id") UUID sessionId,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        PlayableSession playable = sessions.detail(user.id(), sessionId);
        PracticeSession session = playable.session();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("session_id", session.id());
        payload.put("status", session.status());
        payload.put("situation", session.situation());
        payload.put("character_context", session.characterContext());
        payload.put("goal", session.goal());
        payload.put("blockage_kind", session.blockageKind());
        payload.put("sub_branch", session.subBranch());
        payload.put("blockage_detail", session.blockageDetail());
        payload.put("playback_url", playable.playbackUrl());
        payload.put("created_at", session.createdAt());
        payload.put("updated_at", session.updatedAt());
        if (playable.summary() != null) {
            ObservationPackResponse summary =
                    PracticeSessionDtos.observationPack(playable.summary());
            payload.put("summary", summary);
        }
        if (session.failed()) {
            payload.put("error_code", playable.errorCode());
        }
        return payload;
    }

    @Operation(
            summary = "Reanalyze Session",
            operationId = "reanalyze_session_v2_practice_sessions__session_id__analyze_post",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeSessionCreateResponse.class))),
        @ApiResponse(
                responseCode = "202",
                description = "Accepted",
                content = @Content(schema = @Schema(implementation = PracticeSessionAcceptedResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/{session_id}/analyze")
    ResponseEntity<byte[]> analyze(
            @PathVariable("session_id") UUID sessionId,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        UUID requestId = requestId(requestIdHeader);
        return json(sessions.reanalyze(user.id(), sessionId, requestId), requestId);
    }

    @Operation(
            summary = "Delete Session",
            operationId = "delete_session_v2_practice_sessions__session_id__delete",
            tags = "v2-practice",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "No Content"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/{session_id}")
    ResponseEntity<Void> delete(
            @PathVariable("session_id") UUID sessionId,
            HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        sessions.delete(user.id(), sessionId);
        return ResponseEntity.noContent().build();
    }

    /** 결과를 상태코드와 본문으로 옮긴다. 어느 결과가 어느 코드인지는 이 층의 결정이다. */
    private ResponseEntity<byte[]> json(AnalysisOutcome outcome, UUID requestId) {
        return switch (outcome) {
            case AnalysisOutcome.Accepted accepted ->
                    json(HttpStatus.ACCEPTED, sessionPayload(accepted.sessionId()), requestId);
            case AnalysisOutcome.Completed completed -> json(
                    HttpStatus.OK,
                    sessionPayload(completed.sessionId(), completed.status()),
                    requestId);
            case AnalysisOutcome.Replayed replayed ->
                    json(HttpStatus.OK, replayed.payload(), requestId);
        };
    }

    private ResponseEntity<byte[]> json(HttpStatus status, Object payload, UUID requestId) {
        return ResponseEntity.status(status)
                .header("X-Request-Id", requestId.toString())
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .body(canonical.bytes(payload));
    }

    private static Map<String, Object> sessionPayload(UUID sessionId) {
        return sessionPayload(sessionId, "analyzing");
    }

    private static Map<String, Object> sessionPayload(UUID sessionId, String status) {
        return Map.of("session_id", sessionId.toString(), "status", status);
    }

    private static UUID requestId(String header) {
        if (header == null) {
            return UUID.randomUUID();
        }
        try {
            return UUID.fromString(header);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(422, "invalid X-Request-Id");
        }
    }

    private static PracticeSessionListItem listItem(PracticeSession session) {
        return new PracticeSessionListItem(
                session.id(),
                session.status(),
                session.situation(),
                session.characterContext(),
                session.goal(),
                session.blockageKind(),
                session.subBranch(),
                session.blockageDetail(),
                session.createdAt(),
                session.updatedAt());
    }

    /** 파이썬 pydantic 이 리터럴 불일치에 내던 422 본문을 그대로 만든다. */
    private static void validateLiteral(String field, String input, List<String> allowed) {
        if (input == null || allowed.contains(input)) {
            return;
        }
        List<String> quoted = allowed.stream().map(value -> "'" + value + "'").toList();
        String expected = quoted.size() == 1
                ? quoted.getFirst()
                : String.join(", ", quoted.subList(0, quoted.size() - 1))
                        + " or " + quoted.getLast();
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "enum");
        error.put("loc", List.of("body", field));
        error.put("msg", "Input should be " + expected);
        error.put("input", input);
        error.put("ctx", Map.of("expected", expected));
        throw new ApiValidationException(List.of(error));
    }
}
