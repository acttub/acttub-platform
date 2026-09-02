package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachCommands.ActorMessage;
import com.acttub.actingapi.feature.coach.app.CoachCommands.CoachStart;
import com.acttub.actingapi.feature.coach.app.CoachCommands.HandoffDecision;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.feature.report.app.OwnedReportSource;
import com.acttub.actingapi.feature.report.app.PracticeReportLedger;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.feature.report.app.ReportOperationLedger;
import com.acttub.actingapi.feature.report.app.ReportParseError;
import com.acttub.actingapi.feature.report.app.ReportPlayback;
import com.acttub.actingapi.feature.report.app.ReportRepository;
import com.acttub.actingapi.feature.report.app.ReportService;
import com.acttub.actingapi.feature.report.app.ReportSourceProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class CoachServiceTest {

    private static final UUID USER_ID = UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID PRACTICE_ID = UUID.fromString("20000000-0000-4000-8000-000000000002");
    private static final UUID SESSION_ID = UUID.fromString("30000000-0000-4000-8000-000000000003");
    private static final UUID HANDOFF_ID = UUID.fromString("40000000-0000-4000-8000-000000000004");
    private static final UUID REQUEST_ID = UUID.fromString("50000000-0000-4000-8000-000000000005");
    private static final SyncOperationClaim CLAIM = new SyncOperationClaim(
            UUID.fromString("60000000-0000-4000-8000-000000000006"),
            UUID.fromString("70000000-0000-4000-8000-000000000007"),
            REQUEST_ID);

    private final CoachSessionRepository sessions = mock(CoachSessionRepository.class);
    private final CoachSessionLedger ledger = mock(CoachSessionLedger.class);
    private final CoachEngine coach = mock(CoachEngine.class);
    private final ReportEngine reports = mock(ReportEngine.class);
    private final PracticeReportLedger reportOperations = mock(PracticeReportLedger.class);
    private final CoachOperationLedger operations = mock(CoachOperationLedger.class);
    private final CoachMemory memory = mock(CoachMemory.class);
    private final CoachResponseRenderer renderer = mock(CoachResponseRenderer.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final RecordingFailureReporter failureReporter = new RecordingFailureReporter();

    private CoachService service;

    @BeforeEach
    void setUp() {
        // 성적표 서비스는 가짜가 아니라 진짜다 — 이 테스트들이 보는 것이 "모델을 안 불렀다"이고,
        // 그 호출은 ReportService 안에서 일어난다. 통째로 mock 하면 검증이 빈 채로 통과한다.
        ReportService reportService = new ReportService(
                mock(ReportRepository.class),
                mock(ReportSourceProvider.class),
                reportOperations,
                mock(ReportOperationLedger.class),
                reports,
                mock(ReportPlayback.class));
        service = new CoachService(
                sessions,
                ledger,
                operations,
                coach,
                memory,
                renderer,
                reports,
                reportService,
                reportOperations,
                mapper,
                failureReporter);
        when(operations.requestId(any())).thenReturn(REQUEST_ID);
        when(operations.fingerprint(anyString(), any())).thenReturn("0".repeat(64));
        when(operations.begin(any(), any(), any(), anyString(), anyString()))
                .thenReturn(SyncOperationBegin.claimed(CLAIM));
        when(operations.now()).thenReturn(Instant.parse("2026-08-12T00:00:00Z"));
        when(renderer.turn(any(), any(), any(), any(), any())).thenReturn(mapper.createObjectNode());
        when(renderer.resumed(any())).thenReturn(mapper.createObjectNode());
        when(renderer.confirmation(any(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenReturn(mapper.createObjectNode());
    }

    @Test
    void startResumeReturnsStoredConversationWithoutCallingEitherLlmOrCreatingOperation() {
        CoachSessionSnapshot session = snapshot("open", List.of(
                new CoachTurnSnapshot("actor", "배우 말"),
                new CoachTurnSnapshot("ai", "저장된 질문")));
        stubStartContext();
        when(sessions.getOldestOpenCoachSession(USER_ID, PRACTICE_ID))
                .thenReturn(new OwnedCoachSessionContext(PRACTICE_ID, session));
        when(sessions.hasReportForPracticeSession(PRACTICE_ID)).thenReturn(false);

        service.start(USER_ID, new CoachStart(PRACTICE_ID, false), null);

        verify(coach, never()).start(any(), any());
        verify(reports, never()).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        verify(operations, never()).begin(any(), any(), any(), anyString(), anyString());
    }

    @Test
    void startResumeRejectsExistingReportBeforeCallingLlmOrCreatingOperation() {
        stubStartContext();
        when(sessions.getOldestOpenCoachSession(USER_ID, PRACTICE_ID))
                .thenReturn(new OwnedCoachSessionContext(
                        PRACTICE_ID, snapshot("open", List.of())));
        when(sessions.hasReportForPracticeSession(PRACTICE_ID)).thenReturn(true);

        assertThatThrownBy(() -> service.start(
                USER_ID, new CoachStart(PRACTICE_ID, false), null))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(409);
                    assertThat(exception.getMessage())
                            .isEqualTo("report already exists for practice session");
                });

        verify(coach, never()).start(any(), any());
        verify(reports, never()).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        verify(operations, never()).begin(any(), any(), any(), anyString(), anyString());
    }

    @Test
    void confirmReusesExistingReportWithoutCallingReportLlm() throws Exception {
        OwnedReportSource source = reportSource(true);
        JsonNode existing = mapper.readTree("""
                {"report_type":"analysis","title":"이미 저장됨"}
                """);
        stubOwnedSession();
        when(ledger.confirmLatestHandoff(USER_ID, SESSION_ID, true, null, operations.now()))
                .thenReturn(source);
        when(sessions.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(existing);

        service.confirm(USER_ID, new HandoffDecision(SESSION_ID, true, null), null);

        verify(reports, never()).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        verify(operations).complete(org.mockito.ArgumentMatchers.eq(CLAIM), any(JsonNode.class));
    }

    @Test
    void confirmCommitsConfirmationBeforeParseFailureAndMarksOperation() {
        OwnedReportSource source = reportSource(true);
        stubOwnedSession();
        when(ledger.confirmLatestHandoff(USER_ID, SESSION_ID, true, null, operations.now()))
                .thenReturn(source);
        when(sessions.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(null);
        when(reports.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenThrow(new ReportParseError("invalid report"));

        assertThatThrownBy(() -> service.confirm(
                USER_ID, new HandoffDecision(SESSION_ID, true, null), null))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(502);
                    assertThat(exception.getMessage()).isEqualTo("invalid report");
                    assertThat(exception.getCause())
                            .isInstanceOf(ReportParseError.class)
                            .hasMessage("invalid report");
                    assertThat(exception.failureKind()).contains(FailureKind.EXTERNAL);
                });

        InOrder order = inOrder(ledger, reports, operations);
        order.verify(ledger).confirmLatestHandoff(
                org.mockito.ArgumentMatchers.eq(USER_ID),
                org.mockito.ArgumentMatchers.eq(SESSION_ID),
                org.mockito.ArgumentMatchers.eq(true),
                org.mockito.ArgumentMatchers.isNull(),
                any(Instant.class));
        order.verify(reports).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        order.verify(operations).fail(CLAIM, "report_parse_error");
    }

    /** 세션이 없으면 확정 저장이 예외를 던지고, 그것이 404 와 원장의 실패 표시로 옮겨진다. */
    @Test
    void confirmMapsMissingSessionToThe404AndMarksOperation() {
        stubOwnedSession();
        when(ledger.confirmLatestHandoff(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(),
                any(), any(Instant.class)))
                .thenThrow(new CoachSessionNotFound("coach session not found"));

        assertThatThrownBy(() -> service.confirm(
                USER_ID, new HandoffDecision(SESSION_ID, true, null), null))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(404);
                    assertThat(exception.getMessage()).isEqualTo("session not found");
                    assertThat(exception.getCause())
                            .isInstanceOf(CoachSessionNotFound.class)
                            .hasMessage("coach session not found");
                });

        verify(operations).fail(CLAIM, "session_not_found");
    }

    @Test
    void completedStartAndReplyBothMapReportParseFailureToTheSameOperationError() {
        ObjectNode handoff = mapper.createObjectNode().put("handoff_type", "analysis");
        CoachReply complete = new CoachReply("완료", "complete", handoff);
        CoachSessionSnapshot session = snapshot("open", List.of());
        when(reports.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenThrow(new ReportParseError("bad report"));

        stubStartContext();
        when(sessions.getOldestOpenCoachSession(USER_ID, PRACTICE_ID)).thenReturn(null);
        when(sessions.hasReportForPracticeSession(PRACTICE_ID)).thenReturn(false);
        when(coach.start(any(), any())).thenReturn(new CoachResult(session, complete));
        assertReportParseError(() -> service.start(
                USER_ID, new CoachStart(PRACTICE_ID, false), null));

        // reply 는 답변이 2턴 미만이면 리포트를 만들지 않으므로(차단 노트) 여기서
        // 파싱 실패 경로를 보려면 실제로 답한 턴이 있어야 한다. 첫 actor 턴은 폼 입력이라 빠진다.
        CoachSessionSnapshot answered = snapshot("open", List.of(
                new CoachTurnSnapshot("actor", "폼에 적은 막힌 지점"),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "첫 답변"),
                new CoachTurnSnapshot("ai", "다음 질문"),
                new CoachTurnSnapshot("actor", "다음 답변")));
        stubOwnedSession();
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(answered, complete));
        assertReportParseError(() -> service.reply(
                USER_ID, new ActorMessage(SESSION_ID, "그만"), null));

        verify(operations, org.mockito.Mockito.times(2)).fail(CLAIM, "report_parse_error");
    }

    @Test
    void replyMapsOptimisticLockConflictToTheContract409() {
        CoachSessionSnapshot session = snapshot("open", List.of());
        CoachReply reply = new CoachReply("다음 질문", "continue", null);
        stubOwnedSession();
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(session, reply));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenThrow(new SessionWriteConflict("session turns changed concurrently"));

        assertThatThrownBy(() -> service.reply(
                USER_ID, new ActorMessage(SESSION_ID, "배우 답변"), null))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(409);
                    assertThat(exception.getMessage()).isEqualTo("session changed concurrently");
                    assertThat(exception.getCause())
                            .isInstanceOf(SessionWriteConflict.class)
                            .hasMessage("session turns changed concurrently");
                });

        verify(operations).fail(CLAIM, "session_write_conflict");
    }

    @Test
    void replyReloadsActorMemorySoTheCoachKeepsItMidConversation() {
        // 기억이 첫 질문에만 실리고 답변 턴에서 사라지는 구멍이 실제로 있었다 —
        // dev 에서 배우가 "내 나이 기억해?" 라고 묻자 코치가 모른다고 답했다.
        // 턴마다 다시 읽으므로, 대화 중에 고친 기억도 다음 답변부터 반영된다.
        CoachSessionSnapshot session = snapshot("open", List.of());
        CoachReply reply = new CoachReply("다음 질문", "continue", null);
        stubOwnedSession();
        when(memory.priorFor(USER_ID, PRACTICE_ID, CLAIM.operationId())).thenReturn(new PriorContext(
                Map.of("goal", "입시 합격"), null, true, List.of(), List.of()));
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(session, reply));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenReturn(true);

        service.reply(USER_ID, new ActorMessage(SESSION_ID, "내 목표 기억해?"), null);

        org.mockito.ArgumentCaptor<CoachSessionSnapshot> passed =
                org.mockito.ArgumentCaptor.forClass(CoachSessionSnapshot.class);
        verify(coach).reply(passed.capture(), anyString(), any());
        assertThat(passed.getValue().prior().memory()).containsEntry("goal", "입시 합격");
    }

    @Test
    void priorContextFailureIsReportedWhileReplyStillSucceeds() {
        RuntimeException failure = new IllegalStateException("prior unavailable");
        CoachSessionSnapshot session = snapshot("open", List.of());
        CoachReply reply = new CoachReply("다음 질문", "continue", null);
        stubOwnedSession();
        when(memory.priorFor(USER_ID, PRACTICE_ID, CLAIM.operationId())).thenThrow(failure);
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(session, reply));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenReturn(true);

        CoachPayload payload = service.reply(
                USER_ID, new ActorMessage(SESSION_ID, "계속할게요"), null);

        assertThat(payload).isNotNull();
        assertThat(failureReporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context())
                    .isEqualTo("CoachService.priorContext operation_id=" + CLAIM.operationId());
        });
    }

    @Test
    void aTurnThatClosesWithACardSchedulesTheMemoryUpdate() {
        // 확인이 대화 안에서 끝나는 흐름에서는 /confirm 이 불리지 않는다. dev 실측으로
        // 확인 5건에 기억 갱신 잡이 0건이었다 — 예약이 confirm 에만 달려 있어서다.
        ObjectNode handoff = mapper.createObjectNode().put("handoff_type", "analysis");
        CoachReply complete = new CoachReply("완료", "complete", handoff);
        CoachSessionSnapshot answered = snapshot("open", List.of(
                new CoachTurnSnapshot("actor", "폼에 적은 막힌 지점"),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "첫 답변"),
                new CoachTurnSnapshot("ai", "다음 질문"),
                new CoachTurnSnapshot("actor", "다음 답변")));
        stubOwnedSession();
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(answered, complete));
        when(reports.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenReturn(mapper.createObjectNode().put("report_type", "analysis"));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenReturn(true);
        when(memory.countConfirmedPractices(USER_ID)).thenReturn(1L);

        service.reply(USER_ID, new ActorMessage(SESSION_ID, "맞아요"), null);

        verify(memory).enqueueMemoryUpdate(USER_ID, PRACTICE_ID);
    }

    @Test
    void memoryUpdateSchedulingFailureIsReportedWhileReplyStillSucceeds() {
        RuntimeException failure = new IllegalStateException("queue unavailable");
        ObjectNode handoff = mapper.createObjectNode().put("handoff_type", "analysis");
        CoachReply complete = new CoachReply("완료", "complete", handoff);
        CoachSessionSnapshot answered = snapshot("open", List.of(
                new CoachTurnSnapshot("actor", "폼에 적은 막힌 지점"),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "첫 답변"),
                new CoachTurnSnapshot("ai", "다음 질문"),
                new CoachTurnSnapshot("actor", "다음 답변")));
        stubOwnedSession();
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(answered, complete));
        when(reports.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenReturn(mapper.createObjectNode().put("report_type", "analysis"));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenReturn(true);
        when(memory.countConfirmedPractices(USER_ID)).thenReturn(1L);
        when(memory.enqueueMemoryUpdate(USER_ID, PRACTICE_ID)).thenThrow(failure);

        CoachPayload payload = service.reply(
                USER_ID, new ActorMessage(SESSION_ID, "맞아요"), null);

        assertThat(payload).isNotNull();
        assertThat(failureReporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo(
                    "CoachService.scheduleMemoryUpdate operation_id=" + CLAIM.operationId());
        });
    }

    @Test
    void anOngoingTurnDoesNotTouchTheMemoryQueue() {
        // 카드 없이 이어지는 턴마다 예약이 걸리면 케이던스가 무의미해진다.
        CoachSessionSnapshot session = snapshot("open", List.of());
        CoachReply reply = new CoachReply("다음 질문", "continue", null);
        stubOwnedSession();
        when(coach.reply(any(), anyString(), any())).thenReturn(new CoachResult(session, reply));
        when(ledger.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenReturn(true);

        service.reply(USER_ID, new ActorMessage(SESSION_ID, "음..."), null);

        verify(memory, never()).enqueueMemoryUpdate(any(), any());
    }

    private void assertReportParseError(Runnable invocation) {
        assertThatThrownBy(invocation::run)
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(502);
                    assertThat(exception.getMessage()).isEqualTo("bad report");
                    assertThat(exception.getCause())
                            .isInstanceOf(ReportParseError.class)
                            .hasMessage("bad report");
                    assertThat(exception.failureKind()).contains(FailureKind.EXTERNAL);
                });
    }

    private void stubStartContext() {
        when(sessions.getPracticeSessionStatus(USER_ID, PRACTICE_ID)).thenReturn("analyzed");
        when(sessions.getOwnedPracticeSessionContext(USER_ID, PRACTICE_ID))
                .thenReturn(new OwnedPracticeSessionContext(
                        PRACTICE_ID,
                        null,
                        USER_ID,
                        emptyPack(),
                        "상황",
                        "인물",
                        "목표",
                        1000,
                        "분석",
                        "대사 분석",
                        "막힘",
                        List.of(),
                        null));
    }

    private void stubOwnedSession() {
        when(sessions.getOwnedCoachSession(USER_ID, SESSION_ID))
                .thenReturn(new OwnedCoachSessionContext(
                        PRACTICE_ID, snapshot("open", List.of())));
    }

    private CoachSessionSnapshot snapshot(String status, List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(
                SESSION_ID,
                PRACTICE_ID,
                null,
                USER_ID,
                emptyPack(),
                "상황",
                "인물",
                "목표",
                1000,
                "분석",
                "대사 분석",
                "막힘",
                List.of(),
                "",
                null,
                status,
                "",
                turns);
    }

    private OwnedReportSource reportSource(boolean confirmed) {
        return new OwnedReportSource(
                PRACTICE_ID,
                SESSION_ID,
                emptyPack(),
                "analysis",
                HANDOFF_ID,
                mapper.createObjectNode().put("handoff_type", "analysis"),
                confirmed,
                null,
                null);
    }

    private ObjectNode emptyPack() {
        ObjectNode pack = mapper.createObjectNode();
        pack.set("observations", mapper.createArrayNode());
        pack.set("uncertainties", mapper.createArrayNode());
        return pack;
    }
}
