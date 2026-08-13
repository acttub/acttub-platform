package com.acttub.actingapi.practice;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.auth.AuthDependencies;
import com.acttub.actingapi.operation.ExternalOperationRow;
import com.acttub.actingapi.operation.ExternalOperationStore;
import com.acttub.actingapi.operation.PracticeSessionOperation;
import com.acttub.actingapi.practice.PracticeSessionDtos.ObservationPackResponse;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionAcceptedResponse;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionCreateResponse;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionDetail;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionListItem;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionListResponse;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionRequest;
import com.acttub.actingapi.practice.PracticeSessionDtos.PracticeSessionStatusResponse;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.storage.NoCredentialsError;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.ApiValidationException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

@RestController
@RequestMapping("/v2/practice-sessions")
class PracticeSessionController {
    private static final int PLAYBACK_URL_TTL_SECONDS = 15 * 60;
    private static final List<String> BLOCKAGE_KINDS = List.of("분석", "표현", "그 외");
    private static final List<String> SUB_BRANCHES = List.of(
            "캐릭터 분석", "대사 분석", "감정", "움직임", "화술", "표정", "그 외");

    private final ExternalOperationStore operations;
    private final PracticeSessionStore sessions;
    private final Optional<ObjectStorage> configuredStorage;
    private final AuthDependencies auth;
    private final Clock clock;
    private final CanonicalJson canonical;

    PracticeSessionController(
            ExternalOperationStore operations,
            PracticeSessionStore sessions,
            Optional<ObjectStorage> configuredStorage,
            AuthDependencies auth,
            Clock clock,
            ObjectMapper mapper) {
        this.operations = operations;
        this.sessions = sessions;
        this.configuredStorage = configuredStorage;
        this.auth = auth;
        this.clock = clock;
        this.canonical = new CanonicalJson(mapper);
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
        validateLiteral("blockage_kind", body.blockageKind(), BLOCKAGE_KINDS);
        validateLiteral("sub_branch", body.subBranch(), SUB_BRANCHES);
        UUID requestId = requestId(requestIdHeader);
        if (!sessions.uploadExists(user.id(), body.uploadIntentId())) {
            throw new ApiException(404, "upload_intent_not_found");
        }
        Map<String, Object> fingerprintPayload = new LinkedHashMap<>();
        fingerprintPayload.put("upload_intent_id", body.uploadIntentId().toString());
        fingerprintPayload.put("situation", body.situation());
        fingerprintPayload.put("character_context", body.characterContext());
        fingerprintPayload.put("goal", body.goal());
        fingerprintPayload.put("blockage_kind", body.blockageKind());
        fingerprintPayload.put("sub_branch", body.subBranch());
        fingerprintPayload.put("blockage_detail", body.blockageDetail());
        String fingerprint = fingerprint(fingerprintPayload);
        PracticeSessionOperation result = operations.createPracticeSessionWithAnalysisOperation(
                user.id(),
                body.uploadIntentId(),
                body.situation(),
                body.characterContext(),
                body.goal(),
                body.blockageKind(),
                body.subBranch(),
                body.blockageDetail(),
                requestId,
                fingerprint);
        if (result == null) {
            throw new ApiException(409, "upload_intent_not_finalized");
        }
        return operationResponse(result, user.id(), requestId);
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
        PracticeSessionStore.StatusRow status = sessions.status(user.id(), sessionId);
        if (status == null) {
            throw new ApiException(404, "practice_session_not_found");
        }
        return new PracticeSessionStatusResponse(status.status(), status.errorCode());
    }

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
        PracticeSessionStore.DetailRow detail = sessions.detail(user.id(), sessionId);
        if (detail == null) {
            throw new ApiException(404, "practice_session_not_found");
        }
        ObjectStorage storage = configuredStorage.orElseThrow(
                () -> new NoCredentialsError("storage is not configured"));
        String playbackUrl = storage.presignPlayback(
                detail.objectKey(), PLAYBACK_URL_TTL_SECONDS);
        PracticeSessionStore.SessionRow row = detail.session();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("session_id", row.id());
        payload.put("status", row.status());
        payload.put("situation", row.situation());
        payload.put("character_context", row.characterContext());
        payload.put("goal", row.goal());
        payload.put("blockage_kind", row.blockageKind());
        payload.put("sub_branch", row.subBranch());
        payload.put("blockage_detail", row.blockageDetail());
        payload.put("playback_url", playbackUrl);
        payload.put("created_at", row.createdAt());
        payload.put("updated_at", row.updatedAt());
        if ("analyzed".equals(row.status()) && detail.summaryId() != null) {
            ObservationPackResponse summary = PracticeSessionDtos.observationPack(
                    detail.summaryId(), detail.observations(), detail.uncertainties());
            payload.put("summary", summary);
        }
        if ("failed".equals(row.status())) {
            payload.put("error_code", detail.errorCode());
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
        String fingerprint = fingerprint(Map.of("session_id", sessionId.toString()));
        PracticeSessionOperation result = operations.createAnalysisRetryOperation(
                user.id(), sessionId, requestId, fingerprint, clock.instant());
        if (result == null) {
            if (sessions.find(user.id(), sessionId) == null) {
                throw new ApiException(404, "practice_session_not_found");
            }
            throw new ApiException(409, "session_is_not_failed");
        }
        return operationResponse(result, user.id(), requestId);
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
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        if (!sessions.hide(user.id(), sessionId, now)) {
            throw new ApiException(404, "practice_session_not_found");
        }
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<byte[]> operationResponse(
            PracticeSessionOperation result,
            UUID userId,
            UUID requestId) {
        if (result.fingerprintMismatch()) {
            throw new ApiException(422, "request_fingerprint_mismatch");
        }
        if (result.created()) {
            return json(HttpStatus.ACCEPTED, sessionPayload(result.session().id()), requestId);
        }
        ExternalOperationRow operation = result.operation();
        return switch (operation.status()) {
            case "succeeded" -> {
                JsonNode stored = operation.responsePayload();
                Object payload = stored == null || stored.isEmpty()
                        ? sessionPayload(result.session().id(), result.session().status())
                        : stored;
                yield json(HttpStatus.OK, payload, requestId);
            }
            case "pending", "running" ->
                    json(HttpStatus.ACCEPTED, sessionPayload(operation.sessionId()), requestId);
            case "failed" -> {
                boolean resumed = sessions.resumeFailedOperation(
                        userId,
                        operation.id(),
                        clock.instant().atOffset(ZoneOffset.UTC));
                if (!resumed) {
                    throw new ApiException(409, "analysis_retry_exhausted");
                }
                yield json(HttpStatus.ACCEPTED, sessionPayload(operation.sessionId()), requestId);
            }
            default -> throw new ApiException(409, "invalid_operation_state");
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

    private String fingerprint(Map<String, Object> payload) {
        byte[] bytes = canonical.bytes(Map.of("kind", "analyze", "payload", payload));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
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

    private static PracticeSessionListItem listItem(PracticeSessionStore.SessionRow row) {
        return new PracticeSessionListItem(
                row.id(),
                row.status(),
                row.situation(),
                row.characterContext(),
                row.goal(),
                row.blockageKind(),
                row.subBranch(),
                row.blockageDetail(),
                row.createdAt(),
                row.updatedAt());
    }

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
