package com.acttub.actingapi.feature.admin.adapter.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminSessions;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminStats;
import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
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
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class AdminController {
    private static final int MAX_SESSIONS = 50;

    private final AdminService admin;
    private final byte[] expectedAuthorization;

    AdminController(AdminService admin, @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.admin = admin;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
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
        return admin.stats();
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
        return admin.sessions(limit);
    }

    /** 길이가 달라도 같은 시간이 걸리도록 {@link MessageDigest#isEqual} 로 견준다. */
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
            Map<String, Object> error = new LinkedHashMap<>();
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
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", List.of("query", "limit"));
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", Map.of(contextKey, contextValue));
        return new ApiValidationException(List.of(error));
    }
}
