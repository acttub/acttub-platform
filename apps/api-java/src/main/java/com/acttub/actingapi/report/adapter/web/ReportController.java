package com.acttub.actingapi.report.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.CanonicalJsonResponse;
import com.acttub.actingapi.report.adapter.web.ReportDtos.AnalysisReport;
import com.acttub.actingapi.report.adapter.web.ReportDtos.BlockedReport;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ExpressionReport;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ReportDetailResponse;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ReportHistoryResponse;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ReportRecord;
import com.acttub.actingapi.report.adapter.web.ReportDtos.ReportReq;
import com.acttub.actingapi.report.app.PlayableReport;
import com.acttub.actingapi.report.app.ReportPayload;
import com.acttub.actingapi.report.app.ReportService;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/reports")
class ReportController {

    private final AccessGate auth;
    private final ReportService reports;
    private final CanonicalJsonResponse responses;

    ReportController(
            AccessGate auth,
            ReportService reports,
            CanonicalJsonResponse responses) {
        this.auth = auth;
        this.reports = reports;
        this.responses = responses;
    }

    @Operation(
            summary = "Create Report",
            operationId = "create_report_v2_reports_post",
            tags = "v2-reports",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(
                        title = "Response 200 Create Report V2 Reports Post",
                        anyOf = {
                            AnalysisReport.class,
                            ExpressionReport.class,
                            BlockedReport.class
                        }))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping
    ResponseEntity<byte[]> create(
            @Valid @RequestBody ReportReq req,
            @Parameter(
                    name = "X-Request-Id",
                    required = false,
                    schema = @Schema(nullable = true))
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        var user = auth.consentedUser(request);
        ReportPayload payload = reports.create(user.id(), req.sessionId(), requestIdHeader);
        return responses.ok(payload.body(), payload.requestId());
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
        var reportRecords = reports.history(user.id()).stream()
                .map(summary -> new ReportRecord(
                        summary.practiceSessionId(),
                        summary.reportType(),
                        summary.title(),
                        summary.createdAt()))
                .toList();
        return new ReportHistoryResponse(reportRecords.size(), reportRecords);
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
        PlayableReport playable = reports.detail(user.id(), practiceSessionId);
        return new ReportDetailResponse(
                playable.report().practiceSessionId(),
                playable.report().createdAt(),
                playable.report().report(),
                playable.playbackUrl());
    }
}
