package com.acttub.actingapi.report;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.security.AccessGate;
import com.acttub.actingapi.ledger.LeaseOwnershipException;
import com.acttub.actingapi.ledger.SyncOperationBegin;
import com.acttub.actingapi.ledger.SyncOperationClaim;
import com.acttub.actingapi.report.ReportDtos.AnalysisReport;
import com.acttub.actingapi.report.ReportDtos.BlockedReport;
import com.acttub.actingapi.report.ReportDtos.ExpressionReport;
import com.acttub.actingapi.report.ReportDtos.ReportDetailResponse;
import com.acttub.actingapi.report.ReportDtos.ReportHistoryResponse;
import com.acttub.actingapi.report.ReportDtos.ReportReq;
import com.acttub.actingapi.report.ReportDtos.ReportRecord;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.storage.NoCredentialsError;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.CanonicalJsonResponse;
import com.fasterxml.jackson.databind.JsonNode;
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
    private static final int PLAYBACK_URL_TTL_SECONDS = 15 * 60;

    private final ReportQueryStore store;
    private final Optional<ObjectStorage> configuredStorage;
    private final AccessGate auth;
    private final ReportSourceProvider reportSource;
    private final ReportEngine reportEngine;
    private final ReportOperationService reportOperations;
    private final ReportOperationLedger syncOperations;
    private final CanonicalJsonResponse responses;

    ReportController(
            ReportQueryStore store,
            Optional<ObjectStorage> configuredStorage,
            AccessGate auth,
            ReportSourceProvider reportSource,
            ReportEngine reportEngine,
            ReportOperationService reportOperations,
            ReportOperationLedger syncOperations,
            CanonicalJsonResponse responses) {
        this.store = store;
        this.configuredStorage = configuredStorage;
        this.auth = auth;
        this.reportSource = reportSource;
        this.reportEngine = reportEngine;
        this.reportOperations = reportOperations;
        this.syncOperations = syncOperations;
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
        OwnedReportSource source = reportSource.getOwnedReportSource(user.id(), req.sessionId());
        if (source == null) {
            throw new ApiException(404, "session not found");
        }
        UUID requestId = syncOperations.requestId(requestIdHeader);
        SyncOperationBegin begun = syncOperations.begin(
                user.id(),
                source.practiceSessionId(),
                requestId,
                "report",
                syncOperations.fingerprint("report", req));
        if (begun.isReplay()) {
            return responses.ok(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();

        try {
            JsonNode existing = source.handoffId() == null
                    ? null
                    : reportSource.getPracticeReportForHandoff(source.handoffId());
            JsonNode report = existing == null ? generateSourceReport(source) : existing;
            if ("blocked".equals(report.path("report_type").asText()) || existing != null) {
                syncOperations.complete(claim, report);
            } else {
                boolean saved = reportOperations.completePracticeReportOperation(
                        claim.operationId(),
                        claim.leaseToken(),
                        source.practiceSessionId(),
                        report.path("report_type").asText(),
                        report,
                        source.handoffId(),
                        report,
                        syncOperations.now());
                if (!saved) {
                    syncOperations.fail(claim, "report_already_exists");
                    throw new ApiException(409, "report already exists");
                }
            }
            return responses.ok(report, claim.requestId());
        } catch (ReportParseError exception) {
            syncOperations.fail(claim, "report_parse_error");
            throw new ApiException(502, exception.getMessage());
        } catch (LeaseOwnershipException exception) {
            syncOperations.fail(claim, "lease_ownership_lost");
            throw new ApiException(409, "request is still processing");
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            syncOperations.fail(claim, "report_failed");
            throw exception;
        }
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
                () -> new NoCredentialsError("storage is not configured"));
        String playbackUrl = storage.presignPlayback(
                detail.objectKey(), PLAYBACK_URL_TTL_SECONDS);
        return new ReportDetailResponse(
                detail.practiceSessionId(),
                detail.createdAt(),
                detail.report(),
                playbackUrl);
    }

    private JsonNode generateSourceReport(OwnedReportSource source) {
        return reportEngine.generateReport(
                source.branchKind(),
                source.videoSummary(),
                source.handoffJson(),
                source.confirmed(),
                source.handoffId() == null ? "" : source.handoffId().toString(),
                source.analysisHandoffJson(),
                source.analysisHandoffId() == null
                        ? null
                        : source.analysisHandoffId().toString());
    }
}
