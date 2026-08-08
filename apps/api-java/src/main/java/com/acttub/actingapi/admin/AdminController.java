package com.acttub.actingapi.admin;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import com.acttub.actingapi.admin.AdminDtos.AdminSession;
import com.acttub.actingapi.admin.AdminDtos.AdminSessions;
import com.acttub.actingapi.admin.AdminDtos.AdminStats;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression("T(org.springframework.util.StringUtils).hasText('${ADMIN_OPS_TOKEN:}')")
class AdminController {
    private static final int PLAYBACK_TTL_SECONDS = 3600;
    private static final int MAX_SESSIONS = 50;

    private final AdminStore store;
    private final Optional<ObjectStorage> configuredStorage;
    private final byte[] expectedAuthorization;
    private final List<String> excludeEmails;

    AdminController(
            AdminStore store,
            Optional<ObjectStorage> configuredStorage,
            @Value("${ADMIN_OPS_TOKEN}") String adminToken,
            @Value("${ADMIN_OPS_EXCLUDE_EMAILS:}") String excludeEmails) {
        this.store = store;
        this.configuredStorage = configuredStorage;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
        this.excludeEmails = Arrays.stream(excludeEmails.split(","))
                .map(String::strip)
                .filter(value -> !value.isEmpty())
                .toList();
    }

    @Operation(summary = "Stats", operationId = "stats_v2_admin_stats_get", tags = "admin")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = AdminStats.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/stats")
    AdminStats stats(
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return store.stats(excludeEmails);
    }

    @Operation(summary = "Sessions", operationId = "sessions_v2_admin_sessions_get", tags = "admin")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = AdminSessions.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/sessions")
    AdminSessions sessions(
            @Parameter(schema = @Schema(
                    type = "integer",
                    minimum = "1",
                    maximum = "50",
                    exclusiveMinimum = false,
                    exclusiveMaximum = false,
                    defaultValue = "20"))
            @RequestParam(name = "limit", defaultValue = "20") String rawLimit,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        int limit = parseLimit(rawLimit);
        validateLimit(limit);
        List<AdminSession> sessions = new ArrayList<>();
        for (AdminStore.SessionRow row : store.sessions(limit, excludeEmails)) {
            String videoUrl = playbackUrl(row.objectKey());
            sessions.add(new AdminSession(
                    row.coachSessionId().toString(),
                    row.createdAt(),
                    row.status(),
                    row.closeReason(),
                    row.situation(),
                    row.characterContext(),
                    row.goal(),
                    row.turns(),
                    videoUrl));
        }
        return new AdminSessions(List.copyOf(sessions), PLAYBACK_TTL_SECONDS);
    }

    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }

    private static int parseLimit(String rawLimit) {
        try {
            return Integer.parseInt(rawLimit.strip());
        } catch (NumberFormatException exception) {
            java.util.Map<String, Object> error = new java.util.LinkedHashMap<>();
            error.put("type", "int_parsing");
            error.put("loc", List.of("query", "limit"));
            error.put("msg", "Input should be a valid integer, unable to parse string as an integer");
            error.put("input", rawLimit);
            throw new ApiValidationException(List.of(error));
        }
    }

    private static void validateLimit(int limit) {
        if (limit < 1) {
            throw queryError(
                    "greater_than_equal",
                    "Input should be greater than or equal to 1",
                    Integer.toString(limit),
                    "ge",
                    1);
        }
        if (limit > MAX_SESSIONS) {
            throw queryError(
                    "less_than_equal",
                    "Input should be less than or equal to 50",
                    Integer.toString(limit),
                    "le",
                    MAX_SESSIONS);
        }
    }

    private static ApiValidationException queryError(
            String type,
            String message,
            String input,
            String contextKey,
            int contextValue) {
        java.util.Map<String, Object> error = new java.util.LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", List.of("query", "limit"));
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", java.util.Map.of(contextKey, contextValue));
        return new ApiValidationException(List.of(error));
    }

    private String playbackUrl(String objectKey) {
        if (objectKey == null || configuredStorage.isEmpty()) {
            return null;
        }
        try {
            return configuredStorage.get().presignPlayback(objectKey, PLAYBACK_TTL_SECONDS);
        } catch (Exception ignored) {
            return null;
        }
    }
}
