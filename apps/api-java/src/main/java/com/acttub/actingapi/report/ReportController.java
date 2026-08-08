package com.acttub.actingapi.report;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.auth.AuthDependencies;
import com.acttub.actingapi.report.ReportDtos.ReportDetailResponse;
import com.acttub.actingapi.report.ReportDtos.ReportHistoryResponse;
import com.acttub.actingapi.report.ReportDtos.ReportRecord;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.web.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/reports")
class ReportController {
    private static final int PLAYBACK_URL_TTL_SECONDS = 15 * 60;

    private final ReportQueryStore store;
    private final Optional<ObjectStorage> configuredStorage;
    private final AuthDependencies auth;

    ReportController(
            ReportQueryStore store,
            Optional<ObjectStorage> configuredStorage,
            AuthDependencies auth) {
        this.store = store;
        this.configuredStorage = configuredStorage;
        this.auth = auth;
    }

    @Operation(
            summary = "Report History",
            operationId = "report_history_v2_reports_get",
            tags = "v2-reports",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ReportHistoryResponse.class)))
    @GetMapping
    ReportHistoryResponse history(HttpServletRequest request) {
        var user = auth.consentedUser(request);
        var reports = store.listReportSummaries(user.id()).stream()
                .map(row -> new ReportRecord(
                        row.practiceSessionId(),
                        row.reportType(),
                        row.title(),
                        row.createdAt()))
                .toList();
        return new ReportHistoryResponse(reports.size(), reports);
    }

    @Operation(
            summary = "Report Detail",
            operationId = "report_detail_v2_reports__practice_session_id__get",
            tags = "v2-reports",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = ReportDetailResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/{practice_session_id}")
    ReportDetailResponse detail(
            @PathVariable("practice_session_id") UUID practiceSessionId,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        ReportQueryStore.DetailRow detail = store.getReportDetailForPracticeSession(
                user.id(), practiceSessionId);
        if (detail == null) {
            throw new ApiException(404, "report_not_found");
        }
        ObjectStorage storage = configuredStorage.orElseThrow(
                () -> new ApiException(503, "storage_not_configured"));
        String playbackUrl = storage.presignPlayback(
                detail.objectKey(), PLAYBACK_URL_TTL_SECONDS);
        return new ReportDetailResponse(
                detail.practiceSessionId(),
                detail.createdAt(),
                detail.report(),
                playbackUrl);
    }
}
