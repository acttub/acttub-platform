package com.acttub.actingapi.coach;

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
import java.util.UUID;

import com.acttub.actingapi.security.AccessGate;
import com.acttub.actingapi.security.AuthenticatedUser;
import com.acttub.actingapi.report.OwnedReportSource;
import com.acttub.actingapi.coach.CoachDtos.CoachConfirmReq;
import com.acttub.actingapi.coach.CoachDtos.CoachReplyReq;
import com.acttub.actingapi.coach.CoachDtos.CoachStartReq;
import com.acttub.actingapi.schema.UserStatus;
import com.acttub.actingapi.ledger.SyncOperationBegin;
import com.acttub.actingapi.ledger.SyncOperationClaim;
import com.acttub.actingapi.report.ReportEngine;
import com.acttub.actingapi.report.ReportOperationService;
import com.acttub.actingapi.report.ReportParseError;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.CanonicalJsonResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.ResponseEntity;

class CoachControllerTest {

    private static final UUID USER_ID = UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID PRACTICE_ID = UUID.fromString("20000000-0000-4000-8000-000000000002");
    private static final UUID SESSION_ID = UUID.fromString("30000000-0000-4000-8000-000000000003");
    private static final UUID HANDOFF_ID = UUID.fromString("40000000-0000-4000-8000-000000000004");
    private static final UUID REQUEST_ID = UUID.fromString("50000000-0000-4000-8000-000000000005");
    private static final SyncOperationClaim CLAIM = new SyncOperationClaim(
            UUID.fromString("60000000-0000-4000-8000-000000000006"),
            UUID.fromString("70000000-0000-4000-8000-000000000007"),
            REQUEST_ID);

    private final CoachSessionStore sessions = mock(CoachSessionStore.class);
    private final CoachEngine coach = mock(CoachEngine.class);
    private final ReportEngine reports = mock(ReportEngine.class);
    private final ReportOperationService reportOperations = mock(ReportOperationService.class);
    private final CoachOperationLedger operations = mock(CoachOperationLedger.class);
    private final CanonicalJsonResponse responses = mock(CanonicalJsonResponse.class);
    private final AccessGate auth = mock(AccessGate.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final com.acttub.actingapi.memory.MemoryStore memory =
            mock(com.acttub.actingapi.memory.MemoryStore.class);

    private CoachController controller;

    @BeforeEach
    void setUp() {
        controller = new CoachController(
                sessions, coach, reports, reportOperations, operations, responses, auth, mapper, memory);
        when(auth.consentedUser(request)).thenReturn(
                new AuthenticatedUser(USER_ID, "coach@test", UserStatus.ACTIVE));
        when(operations.requestId(any())).thenReturn(REQUEST_ID);
        when(operations.fingerprint(anyString(), any())).thenReturn("0".repeat(64));
        when(operations.begin(any(), any(), any(), anyString(), anyString()))
                .thenReturn(SyncOperationBegin.claimed(CLAIM));
        when(operations.now()).thenReturn(Instant.parse("2026-08-12T00:00:00Z"));
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
        when(responses.ok(any(), any())).thenReturn(ResponseEntity.ok(new byte[0]));

        controller.start(new CoachStartReq(PRACTICE_ID, false), null, request);

        verify(coach, never()).start(any());
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

        assertThatThrownBy(() -> controller.start(
                new CoachStartReq(PRACTICE_ID, false), null, request))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(409);
                    assertThat(exception.getMessage())
                            .isEqualTo("report already exists for practice session");
                });

        verify(coach, never()).start(any());
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
        when(sessions.confirmLatestHandoff(USER_ID, SESSION_ID, true, null, operations.now()))
                .thenReturn(source);
        when(sessions.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(existing);
        when(responses.ok(any(), any())).thenReturn(ResponseEntity.ok(new byte[0]));

        controller.confirm(new CoachConfirmReq(SESSION_ID, true, null), null, request);

        verify(reports, never()).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        verify(operations).complete(org.mockito.ArgumentMatchers.eq(CLAIM), any(JsonNode.class));
    }

    @Test
    void confirmCommitsConfirmationBeforeParseFailureAndMarksOperation() {
        OwnedReportSource source = reportSource(true);
        stubOwnedSession();
        when(sessions.confirmLatestHandoff(USER_ID, SESSION_ID, true, null, operations.now()))
                .thenReturn(source);
        when(sessions.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(null);
        when(reports.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenThrow(new ReportParseError("invalid report"));

        assertThatThrownBy(() -> controller.confirm(
                new CoachConfirmReq(SESSION_ID, true, null), null, request))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(502);
                    assertThat(exception.getMessage()).isEqualTo("invalid report");
                });

        InOrder order = inOrder(sessions, reports, operations);
        order.verify(sessions).confirmLatestHandoff(
                org.mockito.ArgumentMatchers.eq(USER_ID),
                org.mockito.ArgumentMatchers.eq(SESSION_ID),
                org.mockito.ArgumentMatchers.eq(true),
                org.mockito.ArgumentMatchers.isNull(),
                any(Instant.class));
        order.verify(reports).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        order.verify(operations).fail(CLAIM, "report_parse_error");
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
        when(coach.start(any())).thenReturn(new CoachResult(session, complete));
        assertReportParseError(() -> controller.start(
                new CoachStartReq(PRACTICE_ID, false), null, request));

        // reply 는 답변이 2턴 미만이면 리포트를 만들지 않으므로(차단 노트) 여기서
        // 파싱 실패 경로를 보려면 실제로 답한 턴이 있어야 한다. 첫 actor 턴은 폼 입력이라 빠진다.
        CoachSessionSnapshot answered = snapshot("open", List.of(
                new CoachTurnSnapshot("actor", "폼에 적은 막힌 지점"),
                new CoachTurnSnapshot("ai", "첫 질문"),
                new CoachTurnSnapshot("actor", "첫 답변"),
                new CoachTurnSnapshot("ai", "다음 질문"),
                new CoachTurnSnapshot("actor", "다음 답변")));
        stubOwnedSession();
        when(coach.reply(any(), anyString())).thenReturn(new CoachResult(answered, complete));
        assertReportParseError(() -> controller.reply(
                new CoachReplyReq(SESSION_ID, "그만"), null, request));

        verify(operations, org.mockito.Mockito.times(2)).fail(CLAIM, "report_parse_error");
    }

    @Test
    void replyMapsOptimisticLockConflictToTheContract409() {
        CoachSessionSnapshot session = snapshot("open", List.of());
        CoachReply reply = new CoachReply("다음 질문", "continue", null);
        stubOwnedSession();
        when(coach.reply(any(), anyString())).thenReturn(new CoachResult(session, reply));
        when(sessions.completeCoachReplyOperation(
                any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any()))
                .thenThrow(new SessionWriteConflict("session turns changed concurrently"));

        assertThatThrownBy(() -> controller.reply(
                new CoachReplyReq(SESSION_ID, "배우 답변"), null, request))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(409);
                    assertThat(exception.getMessage()).isEqualTo("session changed concurrently");
                });

        verify(operations).fail(CLAIM, "session_write_conflict");
    }

    private void assertReportParseError(Runnable invocation) {
        assertThatThrownBy(invocation::run)
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(502);
                    assertThat(exception.getMessage()).isEqualTo("bad report");
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
