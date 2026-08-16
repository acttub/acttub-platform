package com.acttub.actingapi.coach;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.coach.CoachDtos.CoachConfirmReq;
import com.acttub.actingapi.coach.CoachDtos.CoachConfirmResponse;
import com.acttub.actingapi.coach.CoachDtos.CoachReplyReq;
import com.acttub.actingapi.coach.CoachDtos.CoachStartReq;
import com.acttub.actingapi.coach.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.coach.CoachDtos.PublicCoachTurn;
import com.acttub.actingapi.coach.CoachDtos.PublicHandoff;
import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.report.OwnedReportSource;
import com.acttub.actingapi.report.ReportDtos.AnalysisReport;
import com.acttub.actingapi.report.ReportDtos.BlockedReport;
import com.acttub.actingapi.report.ReportDtos.ExpressionReport;
import com.acttub.actingapi.report.ReportEngine;
import com.acttub.actingapi.report.ReportOperationService;
import com.acttub.actingapi.report.ReportParseError;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJsonResponse;
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

    private static final int MIN_ANSWERS_FOR_REPORT = 2;

    private final CoachSessionStore sessions;
    private final CoachEngine coach;
    private final ReportEngine reports;
    private final ReportOperationService reportOperations;
    private final CoachOperationLedger operations;
    private final CanonicalJsonResponse responses;
    private final AccessGate auth;
    private final ObjectMapper mapper;
    private final com.acttub.actingapi.memory.MemoryStore memory;
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(CoachController.class);

    CoachController(
            CoachSessionStore sessions,
            CoachEngine coach,
            ReportEngine reports,
            ReportOperationService reportOperations,
            CoachOperationLedger operations,
            CanonicalJsonResponse responses,
            AccessGate auth,
            ObjectMapper mapper,
            com.acttub.actingapi.memory.MemoryStore memory) {
        this.sessions = sessions;
        this.coach = coach;
        this.reports = reports;
        this.reportOperations = reportOperations;
        this.operations = operations;
        this.responses = responses;
        this.auth = auth;
        this.mapper = mapper;
        this.memory = memory;
    }

    /**
     * 코치가 알고 시작해야 하는 지난 것들 (`coaching.py:_build_prior_context`).
     *
     * <p><b>모으다 실패해도 대화는 시작돼야 한다.</b> 참고 사항이 없다고 연습을 못 하게
     * 하는 것은 배우 입장에서 말이 안 된다 — 실패하면 빈 것으로 시작한다.
     */
    private PriorContext priorContext(UUID userId, UUID practiceSessionId) {
        try {
            Map<String, String> memoryValues = new LinkedHashMap<>();
            memory.list(userId).forEach(row -> memoryValues.put(row.field(), row.value()));
            var context = memory.priorContext(userId, practiceSessionId);
            return new PriorContext(
                    memoryValues, context.earlierConversation(), context.pendingTakes());
        } catch (RuntimeException failure) {
            LOG.warn("지난 연습 참고 사항을 모으지 못했다: {}", practiceSessionId, failure);
            return PriorContext.EMPTY;
        }
    }

    /**
     * 연습을 마쳤으면 기억 갱신을 뒤에서 돌도록 큐에 넣는다 (`coaching.py:_schedule_memory_update`).
     *
     * <p>여기서 직접 갱신하지 않는 이유는 속도다 — 이 응답은 이미 성적표를 만드느라 느린데
     * 모델 호출을 하나 더 얹으면 배우가 그만큼 더 기다린다. <b>큐에 넣다 실패해도 삼킨다</b> —
     * 기억은 있으면 좋은 것이지, 없다고 방금 끝낸 연습을 실패로 돌려줄 일은 아니다.
     */
    private void scheduleMemoryUpdate(UUID userId, UUID practiceSessionId, boolean confirmed) {
        if (!confirmed) {
            return;
        }
        try {
            if (!shouldUpdateMemory(memory.countConfirmedPractices(userId))) {
                return;
            }
            memory.enqueueMemoryUpdate(userId, practiceSessionId);
        } catch (RuntimeException failure) {
            LOG.warn("기억 갱신 예약에 실패했다: {}", practiceSessionId, failure);
        }
    }

    /**
     * 이번 연습 뒤에 기억을 갱신할 차례인지 (`memory_worker.py:should_update_memory`).
     *
     * <p>첫 연습에는 바로 채운다 — 그래야 두 번째 연습부터 코치가 쓸 것이 생긴다. 그 뒤로는
     * 몇 번에 한 번만 돈다. 매번 돌리면 한 번의 이상한 대화가 곧장 기억이 된다.
     */
    static boolean shouldUpdateMemory(long confirmedPracticeCount) {
        if (confirmedPracticeCount <= 0) {
            return false;
        }
        if (confirmedPracticeCount == 1) {
            return true;
        }
        return confirmedPracticeCount % 3 == 0;
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
                return responses.ok(resumedPayload(resumed.session()), requestId);
            }
        }

        SyncOperationBegin begun = operations.begin(
                user.id(),
                owned.practiceSessionId(),
                requestId,
                "coach_start",
                operations.fingerprint("coach_start", req));
        if (begun.isReplay()) {
            return responses.ok(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();
        if (sessions.hasReportForPracticeSession(owned.practiceSessionId())) {
            operations.fail(claim, "report_already_exists");
            throw new ApiException(409, "report already exists for practice session");
        }

        try {
            CoachResult result = coach.start(owned.newCoachSession(UUID.randomUUID())
                    .withPrior(priorContext(user.id(), owned.practiceSessionId())));
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
            return responses.ok(payload, claim.requestId());
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
            return responses.ok(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();

        try {
            CoachResult result = coach.reply(owned.session(), req.text());
            CompletedTurn completed = completeReplyTurn(result.session(), result.reply());
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
            return responses.ok(payload, claim.requestId());
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
            return responses.ok(begun.replayPayload(), requestId);
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
            scheduleMemoryUpdate(user.id(), source.practiceSessionId(), req.confirmed());
            return responses.ok(payload, claim.requestId());
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

    /**
     * 배우가 실제로 답한 게 거의 없으면 노트를 만들지 않는다.
     *
     * <p>첫 actor 턴은 대화가 아니라 폼에 적은 목표·막힌 지점이므로(start) 빼고 센다.
     *
     * <p>coach_start 에는 걸지 않는다. 거기에 걸면 리포트 생성이 한 번도 돌지 않아
     * coach_start 의 502(리포트 파싱 실패) 경로가 도달 불가가 되고, 그 502로 retry
     * 소진을 확인하는 계약 하네스 시나리오까지 죽는다. 첫 턴에 바로 complete 되는
     * 경우는 따로 다룬다.
     */
    private CompletedTurn completeReplyTurn(CoachSessionSnapshot session, CoachReply reply) {
        String branch = branch(session.blockageKind());
        if (!"complete".equals(reply.status()) || reply.handoff() == null) {
            return new CompletedTurn(branch, null, null);
        }
        long answered = session.turns().stream()
                .filter(turn -> "actor".equals(turn.role()))
                .skip(1)
                .filter(turn -> !CoachEngine.isClosing(turn.text()))
                .count();
        if (answered < MIN_ANSWERS_FOR_REPORT) {
            return new CompletedTurn(branch, UUID.randomUUID(), reports.blockedReport(branch));
        }
        return completeTurn(session, reply);
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
