package com.acttub.actingapi.feature.admin.adapter.web;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Card;
import com.acttub.actingapi.feature.challenge.app.ChallengeService.Draft;
import com.acttub.actingapi.feature.challenge.app.ChallengeService;
import com.acttub.actingapi.feature.challenge.app.ReactionService;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReport;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReportPage;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import java.time.format.DateTimeParseException;
import org.springframework.http.ResponseEntity;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminSessions;
import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.platform.migration.PracticeDataMigration;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class AdminController {
    private static final int MAX_SESSIONS = 50;
    /** 한 묶음이 한 트랜잭션이다 — 너무 크면 그 트랜잭션이 길어진다. */
    private static final int MAX_BATCH = 1000;

    private final AdminService admin;
    private final PracticeDataMigration migration;
    private final ChallengeService challenges;
    private final ReactionService reactions;
    private final byte[] expectedAuthorization;

    AdminController(
            AdminService admin,
            PracticeDataMigration migration,
            ChallengeService challenges,
            ReactionService reactions,
            @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.admin = admin;
        this.migration = migration;
        this.challenges = challenges;
        this.reactions = reactions;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
    }

    @Schema(name = "AdminChallengeCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ChallengeCreate(@NotNull UUID requestId,
            @NotNull String line, @NotNull String work,
            String character, String sceneNote, @NotNull Integer durationDays,
            String origin, @Schema(nullable = true, type = "string", format = "date") String featuredOn) { }

    @PostMapping("/challenges")
    @Operation(summary = "Create Team Challenge", operationId = "create_team_challenge_v2_admin_challenges_post", tags = "admin")
    @ApiResponse(responseCode = "201", description = "Created", content = @Content(schema = @Schema(implementation = Card.class)))
    @ApiResponse(responseCode = "200", description = "Replay", content = @Content(schema = @Schema(implementation = Card.class)))
    ResponseEntity<Card> createChallenge(
            @Valid @RequestBody ChallengeCreate body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        if (body.origin() != null && !"team".equals(body.origin())) throw ApiValidationException.valueError(
                List.of("body", "origin"), "Value error, admin challenges must have origin team", body.origin());
        var result = challenges.createTeam(body.requestId(), new Draft(
                body.line(), body.work(), body.character(), body.sceneNote(), body.durationDays()), featuredDate(body.featuredOn()));
        return ResponseEntity.status(result.created() ? 201 : 200).body(result.card());
    }

    @Schema(name = "ChallengeModerationRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record Moderation(@NotNull String moderation) { }

    private static LocalDate featuredDate(String value) {
        if (value == null) return null;
        try { return LocalDate.parse(value); }
        catch (DateTimeParseException invalid) {
            throw ApiValidationException.valueError(List.of("body", "featured_on"), "Value error, invalid date", value);
        }
    }

    @PatchMapping("/challenges/{id}/moderation")
    @Operation(summary = "Moderate Challenge", operationId = "moderate_challenge_v2_admin_challenges__id__moderation_patch", tags = "admin")
    Card moderateChallenge(
            @PathVariable UUID id,
            @Valid @RequestBody Moderation body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return challenges.moderate(id, body.moderation());
    }

    @Schema(name = "AdminReportResolution", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Resolution(@NotNull @Schema(allowableValues = {"restored", "kept_hidden", "dismissed"}) String resolution,
            @NotNull @Schema(description = "처리한 운영자") String reviewer,
            @Schema(nullable = true) String note) { }

    @GetMapping("/reports")
    @Operation(summary = "List Challenge Reports", operationId = "list_reports_v2_admin_reports_get", tags = "admin",
            description = "접수순 50개씩. 신고 당시와 지금의 캡션·댓글·대사, 남은 처리 전 신고 수, 24·72시간 목표 시각을 함께 본다.")
    AdminReportPage reports(
            @RequestParam(defaultValue = "received") String status,
            @RequestParam(required = false) String cursor,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return reactions.adminReports(status, cursor);
    }

    @PatchMapping("/reports/{id}")
    @Operation(summary = "Resolve Challenge Report", operationId = "resolve_report_v2_admin_reports__id__patch", tags = "admin",
            description = """
                    restored·dismissed 는 그 대상에 처리 전 신고가 남지 않았을 때만 운영 숨김을 푼다(작성자의 비공개·삭제와
                    챌린지 종료는 그대로). kept_hidden 은 숨김(챌린지는 검토)을 유지한다. 이미 처리한 신고는 422
                    report_already_reviewed.""")
    AdminReport resolveReport(
            @PathVariable UUID id,
            @Valid @RequestBody Resolution body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return reactions.resolve(id, body.resolution(), body.reviewer(), body.note());
    }

    @Operation(
            summary = "Practice Migration",
            description = """
                    옛 연습 테이블의 자료를 1.0.0 테이블로 옮긴다 (02-practice 「1.0.0 스키마 전환」 ③).

                    작은 묶음으로 나눠 돌고 남은 것이 없을 때까지 되풀이한다. 몇 번을 돌려도 같은 결과다 —
                    한 번 고른 원본은 대응표에 적혀 다시 고르지 않는다. 옮기지 않은 자료는 사유와 함께
                    적히고 옛 테이블에 그대로 남는다.""",
            operationId = "practice_migration_v2_admin_practice_migration_post",
            tags = "admin")
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PracticeDataMigration.Report.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/practice-migration")
    PracticeDataMigration.Report practiceMigration(
            @Parameter(schema = @Schema(type = "integer", minimum = "1", maximum = "1000",
                    exclusiveMinimum = false, exclusiveMaximum = false, defaultValue = "200"))
            @RequestParam(name = "batch", defaultValue = "200") String rawBatch,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        int batch = parseBatch(rawBatch);
        return migration.run(batch);
    }

    private static int parseBatch(String rawBatch) {
        int batch;
        try {
            batch = Integer.parseInt(rawBatch.strip());
        } catch (NumberFormatException exception) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("type", "int_parsing");
            error.put("loc", List.of("query", "batch"));
            error.put("msg", "Input should be a valid integer, unable to parse string as an integer");
            error.put("input", rawBatch);
            throw new ApiValidationException(List.of(error));
        }
        if (batch < 1 || batch > MAX_BATCH) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("type", batch < 1 ? "greater_than_equal" : "less_than_equal");
            error.put("loc", List.of("query", "batch"));
            error.put("msg", batch < 1
                    ? "Input should be greater than or equal to 1"
                    : "Input should be less than or equal to " + MAX_BATCH);
            error.put("input", Integer.toString(batch));
            error.put("ctx", Map.of(batch < 1 ? "ge" : "le", batch < 1 ? 1 : MAX_BATCH));
            throw new ApiValidationException(List.of(error));
        }
        return batch;
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
