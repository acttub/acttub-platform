package com.acttub.actingapi.feature.coach.app;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachCommands.ActorMessage;
import com.acttub.actingapi.feature.coach.app.CoachCommands.CoachStart;
import com.acttub.actingapi.feature.coach.app.CoachCommands.HandoffDecision;
import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.feature.coach.domain.HandoffReadiness;
import com.acttub.actingapi.feature.coach.domain.MemoryUpdateCadence;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.feature.report.app.OwnedReportSource;
import com.acttub.actingapi.feature.report.app.PracticeReportLedger;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.feature.report.app.ReportParseError;
import com.acttub.actingapi.feature.report.app.ReportService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 코칭 대화의 규칙 (Python {@code acting_api.coaching}). HTTP 도 SQL 도 모르며, 요청 하나가 어떤
 * 순서로 무엇을 확인하고 무엇을 남기는지만 안다.
 *
 * <p>없음·충돌을 {@link ApiException} 으로 던진다. 배관(web)의 타입이지만 다른 feature 의 것이
 * 아니므로 도메인 사이의 결합은 아니다 — 이 예외를 상태코드와 본문으로 옮기는 일은
 * {@code platform/web/ApiErrorAdvice} 하나가 맡고 있고, 그 형태가 곧 계약이다.
 *
 * <p><b>성적표는 {@code report} 에게 맡긴다.</b> 코치는 언제 성적표를 만들지·만든 것을 어디에
 * 실을지만 정하고, 무엇을 어떻게 만드는지는 {@link ReportEngine}·{@link ReportService} 가 안다.
 */
@Service
public class CoachService {

    private static final Logger LOG = LoggerFactory.getLogger(CoachService.class);

    private static final String ANALYZED = "analyzed";
    private static final String FAILED = "failed";
    private static final String CLOSED = "closed";
    private static final String COMPLETE = "complete";

    private final CoachSessionRepository sessions;
    private final CoachSessionLedger ledger;
    private final CoachOperationLedger operations;
    private final CoachEngine coach;
    private final CoachMemory memory;
    private final CoachResponseRenderer renderer;
    private final ReportEngine reports;
    private final ReportService reportService;
    private final PracticeReportLedger practiceReports;
    private final ObjectMapper mapper;

    public CoachService(
            CoachSessionRepository sessions,
            CoachSessionLedger ledger,
            CoachOperationLedger operations,
            CoachEngine coach,
            CoachMemory memory,
            CoachResponseRenderer renderer,
            ReportEngine reports,
            ReportService reportService,
            PracticeReportLedger practiceReports,
            ObjectMapper mapper) {
        this.sessions = sessions;
        this.ledger = ledger;
        this.operations = operations;
        this.coach = coach;
        this.memory = memory;
        this.renderer = renderer;
        this.reports = reports;
        this.reportService = reportService;
        this.practiceReports = practiceReports;
        this.mapper = mapper;
    }

    /**
     * 대화를 연다.
     *
     * <p>분석이 아직 끝나지 않은 연습에는 열지 않는다 — 코치가 볼 관찰이 없는 상태에서 시작하면
     * 배우가 이미 아는 것을 처음부터 다시 말하게 된다. 실패한 분석은 예외인데, 그때는 관찰 없이
     * 라도 대화를 여는 편이 낫다고 이미 정해져 있다.
     */
    public CoachPayload start(UUID userId, CoachStart command, String requestIdHeader) {
        String status = sessions.getPracticeSessionStatus(userId, command.practiceSessionId());
        if (status == null) {
            throw new ApiException(404, "practice session not found");
        }
        if (!ANALYZED.equals(status) && !FAILED.equals(status)) {
            throw new ApiException(409, "practice session analysis is not settled");
        }
        OwnedPracticeSessionContext owned = sessions.getOwnedPracticeSessionContext(
                userId, command.practiceSessionId());
        if (owned == null) {
            throw new ApiException(404, "practice session not found");
        }

        UUID requestId = operations.requestId(requestIdHeader);
        if (!command.restart()) {
            OwnedCoachSessionContext resumed = sessions.getOldestOpenCoachSession(
                    userId, owned.practiceSessionId());
            if (resumed != null) {
                if (sessions.hasReportForPracticeSession(owned.practiceSessionId())) {
                    throw new ApiException(409, "report already exists for practice session");
                }
                return new CoachPayload(renderer.resumed(resumed.session()), requestId);
            }
        }

        SyncOperationBegin begun = operations.begin(
                userId,
                owned.practiceSessionId(),
                requestId,
                "coach_start",
                operations.fingerprint("coach_start", startPayload(command)));
        if (begun.isReplay()) {
            return new CoachPayload(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();
        if (sessions.hasReportForPracticeSession(owned.practiceSessionId())) {
            operations.fail(claim, "report_already_exists");
            throw new ApiException(409, "report already exists for practice session");
        }

        try {
            CoachResult result = coach.start(owned.newCoachSession(UUID.randomUUID())
                    .withPrior(priorContext(userId, owned.practiceSessionId())));
            CompletedTurn completed = completeTurn(result.session(), result.reply());
            ObjectNode payload = renderer.turn(
                    result.session(), result.reply(), completed.handoffId(),
                    completed.branch(), completed.report());
            ledger.completeCoachStartOperation(
                    claim.operationId(),
                    claim.leaseToken(),
                    result.session(),
                    payload,
                    completed.handoffId(),
                    completed.handoffId() == null ? null : completed.branch(),
                    result.reply().handoff(),
                    completed.report() != null,
                    completed.report(),
                    command.restart(),
                    operations.now());
            return new CoachPayload(payload, claim.requestId());
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

    /** 대화를 한 턴 잇는다. */
    public CoachPayload reply(UUID userId, ActorMessage command, String requestIdHeader) {
        OwnedCoachSessionContext owned = sessions.getOwnedCoachSession(
                userId, command.coachSessionId());
        if (owned == null) {
            throw new ApiException(404, "session not found");
        }
        if (CLOSED.equals(owned.session().status())) {
            throw new ApiException(409, "session is closed");
        }
        UUID requestId = operations.requestId(requestIdHeader);
        SyncOperationBegin begun = operations.begin(
                userId,
                owned.practiceSessionId(),
                requestId,
                "coach_reply",
                operations.fingerprint("coach_reply", replyPayload(command)));
        if (begun.isReplay()) {
            return new CoachPayload(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();

        try {
            CoachResult result = coach.reply(owned.session(), command.text());
            CompletedTurn completed = completeReplyTurn(result.session(), result.reply());
            ObjectNode payload = renderer.turn(
                    result.session(), result.reply(), completed.handoffId(),
                    completed.branch(), completed.report());
            ledger.completeCoachReplyOperation(
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
            return new CoachPayload(payload, claim.requestId());
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

    /**
     * 코치가 낸 핸드오프를 배우가 확정하고, 그것으로 성적표를 만든다.
     *
     * <p>같은 핸드오프로 이미 만들어 둔 성적표가 있으면 모델을 다시 부르지 않는다. 차단 노트는
     * 저장하지 않는다 — 그것은 성적표를 만들지 않기로 했다는 표시일 뿐이다.
     */
    public CoachPayload confirm(UUID userId, HandoffDecision command, String requestIdHeader) {
        OwnedCoachSessionContext owned = sessions.getOwnedCoachSession(
                userId, command.coachSessionId());
        if (owned == null) {
            throw new ApiException(404, "session not found");
        }
        UUID requestId = operations.requestId(requestIdHeader);
        SyncOperationBegin begun = operations.begin(
                userId,
                owned.practiceSessionId(),
                requestId,
                "report",
                operations.fingerprint("coach_confirm", confirmPayload(command)));
        if (begun.isReplay()) {
            return new CoachPayload(begun.replayPayload(), requestId);
        }
        SyncOperationClaim claim = begun.claim();

        try {
            // 이 저장은 자체 트랜잭션으로 먼저 커밋된다. 이후 LLM/리포트 실패와 묶지 않는다.
            OwnedReportSource source = ledger.confirmLatestHandoff(
                    userId,
                    command.coachSessionId(),
                    command.confirmed(),
                    command.rebuttalText(),
                    operations.now());
            JsonNode existing = command.confirmed() && source.handoffId() != null
                    ? sessions.getPracticeReportForHandoff(source.handoffId())
                    : null;
            JsonNode report = existing == null ? reportService.reportFor(source) : existing;
            ObjectNode payload = renderer.confirmation(
                    command.coachSessionId(),
                    command.confirmed(),
                    source.handoffId(),
                    source.branchKind(),
                    report);

            // ⚠ 아래 갈래는 ReportService.create 와 모양이 같다. 합치지 않은 것은 남기는 값이
            // 달라서다 — 여기는 확정 응답 전체(payload)를 원장에 남기고 저쪽은 성적표 본문만
            // 남긴다. 한 함수로 모으면 그 차이가 플래그 하나가 되어 실수의 자리가 된다.
            if (reportService.isBlocked(report) || existing != null) {
                operations.complete(claim, payload);
            } else {
                boolean saved = practiceReports.completePracticeReportOperation(
                        claim.operationId(),
                        claim.leaseToken(),
                        source.practiceSessionId(),
                        reportService.typeOf(report),
                        report,
                        source.handoffId(),
                        payload,
                        operations.now());
                if (!saved) {
                    operations.fail(claim, "report_already_exists");
                    throw new ApiException(409, "report already exists");
                }
            }
            scheduleMemoryUpdate(userId, source.practiceSessionId(), command.confirmed());
            return new CoachPayload(payload, claim.requestId());
        } catch (CoachSessionNotFound exception) {
            operations.fail(claim, "session_not_found");
            throw new ApiException(404, "session not found");
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
     * 코치가 알고 시작해야 하는 지난 것들 (`coaching.py:_build_prior_context`).
     *
     * <p><b>모으다 실패해도 대화는 시작돼야 한다.</b> 참고 사항이 없다고 연습을 못 하게 하는 것은
     * 배우 입장에서 말이 안 된다 — 실패하면 빈 것으로 시작한다.
     */
    private PriorContext priorContext(UUID userId, UUID practiceSessionId) {
        try {
            return memory.priorFor(userId, practiceSessionId);
        } catch (RuntimeException failure) {
            LOG.warn("지난 연습 참고 사항을 모으지 못했다: {}", practiceSessionId, failure);
            return PriorContext.EMPTY;
        }
    }

    /**
     * 연습을 마쳤으면 기억 갱신을 뒤에서 돌도록 큐에 넣는다 (`coaching.py:_schedule_memory_update`).
     *
     * <p>여기서 직접 갱신하지 않는 이유는 속도다 — 이 응답은 이미 성적표를 만드느라 느린데 모델
     * 호출을 하나 더 얹으면 배우가 그만큼 더 기다린다. <b>큐에 넣다 실패해도 삼킨다</b> — 기억은
     * 있으면 좋은 것이지, 없다고 방금 끝낸 연습을 실패로 돌려줄 일은 아니다.
     */
    private void scheduleMemoryUpdate(UUID userId, UUID practiceSessionId, boolean confirmed) {
        if (!confirmed) {
            return;
        }
        try {
            if (!MemoryUpdateCadence.shouldUpdate(
                    memory.countConfirmedPractices(userId))) {
                return;
            }
            memory.enqueueMemoryUpdate(userId, practiceSessionId);
        } catch (RuntimeException failure) {
            LOG.warn("기억 갱신 예약에 실패했다: {}", practiceSessionId, failure);
        }
    }

    /**
     * 이어진 턴에서 성적표를 만들지 정한다.
     *
     * <p>배우가 실제로 답한 게 거의 없으면 차단 노트만 낸다. 대화를 여는 자리에는 이 관문을 걸지
     * 않는 이유가 {@link HandoffReadiness} 에 적혀 있다.
     */
    private CompletedTurn completeReplyTurn(CoachSessionSnapshot session, CoachReply reply) {
        String branch = CoachBranch.of(session.blockageKind());
        if (!COMPLETE.equals(reply.status()) || reply.handoff() == null) {
            return new CompletedTurn(branch, null, null);
        }
        if (!HandoffReadiness.hasEnoughAnswers(session.turns())) {
            return new CompletedTurn(branch, UUID.randomUUID(), reports.blockedReport(branch));
        }
        return completeTurn(session, reply);
    }

    private CompletedTurn completeTurn(CoachSessionSnapshot session, CoachReply reply) {
        String branch = CoachBranch.of(session.blockageKind());
        if (!COMPLETE.equals(reply.status()) || reply.handoff() == null) {
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

    /** 관찰이 아직 없는 연습도 성적표 생성을 부를 수 있어야 한다 — 빈 묶음으로 채운다. */
    private JsonNode observationPack(JsonNode value) {
        if (value != null) {
            return value;
        }
        ObjectNode empty = mapper.createObjectNode();
        empty.set("observations", mapper.createArrayNode());
        empty.set("uncertainties", mapper.createArrayNode());
        return empty;
    }

    /**
     * 같은 요청인지 가릴 지문의 입력.
     *
     * <p><b>키는 요청 바디의 것과 같아야 한다.</b> 이 값의 정규 JSON 을 해시한 것이 지문이므로,
     * 키 하나가 달라지면 같은 요청이 다른 지문을 갖고 재시도가 새 작업이 된다.
     */
    private Map<String, Object> startPayload(CoachStart command) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("practice_session_id", command.practiceSessionId().toString());
        payload.put("restart", command.restart());
        return payload;
    }

    private Map<String, Object> replyPayload(ActorMessage command) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("session_id", command.coachSessionId().toString());
        payload.put("text", command.text());
        return payload;
    }

    private Map<String, Object> confirmPayload(HandoffDecision command) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("coach_session_id", command.coachSessionId().toString());
        payload.put("confirmed", command.confirmed());
        payload.put("rebuttal_text", command.rebuttalText());
        return payload;
    }

    private record CompletedTurn(String branch, UUID handoffId, JsonNode report) {
    }
}
