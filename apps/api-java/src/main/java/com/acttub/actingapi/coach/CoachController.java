package com.acttub.actingapi.coach;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.auth.AuthDependencies;
import com.acttub.actingapi.coach.CoachDtos.CoachConfirmReq;
import com.acttub.actingapi.coach.CoachDtos.CoachConfirmResponse;
import com.acttub.actingapi.coach.CoachDtos.CoachReplyReq;
import com.acttub.actingapi.coach.CoachDtos.CoachStartReq;
import com.acttub.actingapi.coach.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.coach.CoachDtos.PublicCoachTurn;
import com.acttub.actingapi.coach.CoachDtos.PublicHandoff;
import com.acttub.actingapi.operation.SyncOperationBegin;
import com.acttub.actingapi.operation.SyncOperationClaim;
import com.acttub.actingapi.operation.SyncOperationService;
import com.acttub.actingapi.report.LeaseOwnershipException;
import com.acttub.actingapi.report.ReportDtos.AnalysisReport;
import com.acttub.actingapi.report.ReportDtos.BlockedReport;
import com.acttub.actingapi.report.ReportDtos.ExpressionReport;
import com.acttub.actingapi.report.ReportEngine;
import com.acttub.actingapi.report.ReportOperationService;
import com.acttub.actingapi.report.ReportParseError;
import com.acttub.actingapi.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

    private final CoachSessionStore sessions;
    private final CoachEngine coach;
    private final ReportEngine reports;
    private final ReportOperationService reportOperations;
    private final SyncOperationService operations;
    private final AuthDependencies auth;
    private final ObjectMapper mapper;

    CoachController(
            CoachSessionStore sessions,
            CoachEngine coach,
            ReportEngine reports,
            ReportOperationService reportOperations,
            SyncOperationService operations,
            AuthDependencies auth,
            ObjectMapper mapper) {
        this.sessions = sessions;
        this.coach = coach;
        this.reports = reports;
        this.reportOperations = reportOperations;
        this.operations = operations;
        this.auth = auth;
        this.mapper = mapper;
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
        String status = sessions.getPracticeSessionStatus(user.id(), req.practiceSessionId());
        if (status == null) {
            throw new ApiException(404, "practice session not found");
        }
        if (!"analyzed".equals(status) && !"failed".equals(status)) {
            throw new ApiException(409, "practice session analysis is not settled");
        }
        OwnedPracticeSessionContext owned = sessions.getOwnedPracticeSessionContext(
                user.id(), req.practiceSessionId());
        if (owned == null) {
            throw new ApiException(404, "practice session not found");
        }

        UUID requestId = operations.requestId(requestIdHeader);
        if (!req.restart()) {
            OwnedCoachSessionContext resumed = sessions.getOldestOpenCoachSession(
                    user.id(), owned.practiceSessionId());
            if (resumed != null) {
                if (sessions.hasReportForPracticeSession(owned.practiceSessionId())) {
                    throw new ApiException(409, "report already exists for practice session");
                }
                return operations.replay(resumedPayload(resumed.session()), requestId);
            }
        }

        SyncOperationBegin begun = operations.begin(
                user.id(),
                owned.practiceSessionId(),
                requestId,
                "coach_start",
                operations.fingerprint("coach_start", req));
        if (begun.isReplay()) {
            return begun.replay();
        }
        SyncOperationClaim claim = begun.claim();
        if (sessions.hasReportForPracticeSession(owned.practiceSessionId())) {
            operations.fail(claim, "report_already_exists");
            throw new ApiException(409, "report already exists for practice session");
        }

        try {
            CoachResult result = coach.start(owned.newCoachSession(UUID.randomUUID()));
            CompletedTurn completed = completeTurn(result.session(), result.reply());
            ObjectNode payload = coachPayload(
                    result.session(), result.reply(), completed.handoffId(),
                    completed.branch(), completed.report());
            sessions.completeCoachStartOperation(
                    claim.operationId(),
                    claim.leaseToken(),
                    result.session(),
                    payload,
                    completed.handoffId(),
                    completed.handoffId() == null ? null : completed.branch(),
                    result.reply().handoff(),
                    completed.report() != null,
                    completed.report(),
                    req.restart(),
                    operations.now());
            return operations.success(payload, claim);
        } catch (LeaseOwnershipException exception) {
            operations.fail(claim, "lease_ownership_lost");
            throw new ApiException(409, "request is still processing");
        } catch (ReportParseError exception) {
            operations.fail(claim, "report_parse_error");
            throw new ApiException(502, exception.getMessage());
        } catch (RuntimeException exception) {
            operations.fail(claim, "coach_start_failed");
            throw exception;
        }
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
        OwnedCoachSessionContext owned = sessions.getOwnedCoachSession(user.id(), req.sessionId());
        if (owned == null) {
            throw new ApiException(404, "session not found");
        }
        if ("closed".equals(owned.session().status())) {
            throw new ApiException(409, "session is closed");
        }
        UUID requestId = operations.requestId(requestIdHeader);
        SyncOperationBegin begun = operations.begin(
                user.id(),
                owned.practiceSessionId(),
                requestId,
                "coach_reply",
                operations.fingerprint("coach_reply", req));
        if (begun.isReplay()) {
            return begun.replay();
        }
        SyncOperationClaim claim = begun.claim();

        try {
            CoachResult result = coach.reply(owned.session(), req.text());
            CompletedTurn completed = completeTurn(result.session(), result.reply());
            ObjectNode payload = coachPayload(
                    result.session(), result.reply(), completed.handoffId(),
                    completed.branch(), completed.report());
            sessions.completeCoachReplyOperation(
                    claim.operationId(),
                    claim.leaseToken(),
                    result.session(),
                    payload,
                    completed.handoffId(),
                    completed.handoffId() == null ? null : completed.branch(),
                    result.reply().handoff(),
                    completed.report() != null,
                    completed.report(),
                    operations.now());
            return operations.success(payload, claim);
        } catch (SessionWriteConflict exception) {
            operations.fail(claim, "session_write_conflict");
            throw new ApiException(409, "session changed concurrently");
        } catch (LeaseOwnershipException exception) {
            operations.fail(claim, "lease_ownership_lost");
            throw new ApiException(409, "request is still processing");
        } catch (ReportParseError exception) {
            operations.fail(claim, "report_parse_error");
            throw new ApiException(502, exception.getMessage());
        } catch (RuntimeException exception) {
            operations.fail(claim, "coach_reply_failed");
            throw exception;
        }
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
        OwnedCoachSessionContext owned = sessions.getOwnedCoachSession(
                user.id(), req.coachSessionId());
        if (owned == null) {
            throw new ApiException(404, "session not found");
        }
        UUID requestId = operations.requestId(requestIdHeader);
        SyncOperationBegin begun = operations.begin(
                user.id(),
                owned.practiceSessionId(),
                requestId,
                "report",
                operations.fingerprint("coach_confirm", req));
        if (begun.isReplay()) {
            return begun.replay();
        }
        SyncOperationClaim claim = begun.claim();

        try {
            // 이 저장은 자체 트랜잭션으로 먼저 커밋된다. 이후 LLM/리포트 실패와 묶지 않는다.
            OwnedReportSource source = sessions.confirmLatestHandoff(
                    user.id(),
                    req.coachSessionId(),
                    req.confirmed(),
                    req.rebuttalText(),
                    operations.now());
            if (source == null) {
                operations.fail(claim, "session_not_found");
                throw new ApiException(404, "session not found");
            }
            JsonNode existing = req.confirmed() && source.handoffId() != null
                    ? sessions.getPracticeReportForHandoff(source.handoffId())
                    : null;
            JsonNode report = existing == null ? generateSourceReport(source) : existing;
            ObjectNode payload = mapper.createObjectNode();
            payload.put("session_id", req.coachSessionId().toString());
            payload.put("confirmed", req.confirmed());
            payload.set("handoff", publicHandoffNode(source.handoffId(), source.branchKind()));
            payload.set("report", report);

            if ("blocked".equals(report.path("report_type").asText()) || existing != null) {
                operations.complete(claim, payload);
            } else {
                boolean saved = reportOperations.completePracticeReportOperation(
                        claim.operationId(),
                        claim.leaseToken(),
                        source.practiceSessionId(),
                        report.path("report_type").asText(),
                        report,
                        source.handoffId(),
                        payload,
                        operations.now());
                if (!saved) {
                    operations.fail(claim, "report_already_exists");
                    throw new ApiException(409, "report already exists");
                }
            }
            return operations.success(payload, claim);
        } catch (ReportParseError exception) {
            operations.fail(claim, "report_parse_error");
            throw new ApiException(502, exception.getMessage());
        } catch (LeaseOwnershipException exception) {
            operations.fail(claim, "lease_ownership_lost");
            throw new ApiException(409, "request is still processing");
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            operations.fail(claim, "coach_confirm_failed");
            throw exception;
        }
    }

    private CompletedTurn completeTurn(CoachSessionSnapshot session, CoachReply reply) {
        String branch = branch(session.blockageKind());
        if (!"complete".equals(reply.status()) || reply.handoff() == null) {
            return new CompletedTurn(branch, null, null);
        }
        UUID handoffId = UUID.randomUUID();
        JsonNode report = reports.generateReport(
                branch,
                observationPack(session.observationPack()),
                reply.handoff(),
                true,
                handoffId.toString(),
                session.analysisHandoff(),
                null);
        return new CompletedTurn(branch, handoffId, report);
    }

    private JsonNode generateSourceReport(OwnedReportSource source) {
        return reports.generateReport(
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

    private ObjectNode coachPayload(
            CoachSessionSnapshot session,
            CoachReply reply,
            UUID handoffId,
            String branch,
            JsonNode report) {
        CoachTurnResponse response = new CoachTurnResponse(
                session.sessionId(),
                reply.message(),
                reply.status(),
                publicHandoff(handoffId, branch),
                report,
                publicTurns(session.turns()));
        return mapper.valueToTree(response);
    }

    private ObjectNode resumedPayload(CoachSessionSnapshot session) {
        String message = "";
        for (int index = session.turns().size() - 1; index >= 0; index--) {
            CoachTurnSnapshot turn = session.turns().get(index);
            if ("ai".equals(turn.role())) {
                message = turn.text();
                break;
            }
        }
        return mapper.valueToTree(new CoachTurnResponse(
                session.sessionId(),
                message,
                "continue",
                null,
                null,
                publicTurns(session.turns())));
    }

    private List<PublicCoachTurn> publicTurns(List<CoachTurnSnapshot> turns) {
        return turns.stream()
                .map(turn -> new PublicCoachTurn(turn.role(), turn.text()))
                .toList();
    }

    private PublicHandoff publicHandoff(UUID handoffId, String branch) {
        return handoffId == null ? null : new PublicHandoff(handoffId, branch);
    }

    private JsonNode publicHandoffNode(UUID handoffId, String branch) {
        PublicHandoff handoff = publicHandoff(handoffId, branch);
        return handoff == null ? mapper.nullNode() : mapper.valueToTree(handoff);
    }

    private JsonNode observationPack(JsonNode value) {
        if (value != null) {
            return value;
        }
        ObjectNode empty = mapper.createObjectNode();
        empty.set("observations", mapper.createArrayNode());
        empty.set("uncertainties", mapper.createArrayNode());
        return empty;
    }

    private String branch(String blockageKind) {
        return "표현".equals(blockageKind) ? "expression" : "analysis";
    }

    private record CompletedTurn(String branch, UUID handoffId, JsonNode report) {
    }
}
