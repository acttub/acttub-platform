package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.security.AuthDependencies;
import com.acttub.actingapi.security.AuthenticatedUser;
import com.acttub.actingapi.schema.UserStatus;
import com.acttub.actingapi.ledger.SyncOperationBegin;
import com.acttub.actingapi.ledger.SyncOperationClaim;
import com.acttub.actingapi.report.ReportDtos.ReportReq;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.CanonicalJsonResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class ReportControllerTest {

    private static final UUID USER_ID = UUID.fromString("10000000-0000-4000-8000-000000000011");
    private static final UUID PRACTICE_ID = UUID.fromString("20000000-0000-4000-8000-000000000012");
    private static final UUID SESSION_ID = UUID.fromString("30000000-0000-4000-8000-000000000013");
    private static final UUID HANDOFF_ID = UUID.fromString("40000000-0000-4000-8000-000000000014");
    private static final SyncOperationClaim CLAIM = new SyncOperationClaim(
            UUID.fromString("50000000-0000-4000-8000-000000000015"),
            UUID.fromString("60000000-0000-4000-8000-000000000016"),
            UUID.fromString("70000000-0000-4000-8000-000000000017"));

    private final ReportQueryStore queryStore = mock(ReportQueryStore.class);
    private final AuthDependencies auth = mock(AuthDependencies.class);
    private final ReportSourceProvider reportSource = mock(ReportSourceProvider.class);
    private final ReportEngine reportEngine = mock(ReportEngine.class);
    private final ReportOperationService reportOperations = mock(ReportOperationService.class);
    private final ReportOperationLedger syncOperations = mock(ReportOperationLedger.class);
    private final CanonicalJsonResponse responses = mock(CanonicalJsonResponse.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private ReportController controller;

    @BeforeEach
    void setUp() {
        controller = new ReportController(
                queryStore,
                Optional.empty(),
                auth,
                reportSource,
                reportEngine,
                reportOperations,
                syncOperations,
                responses);
        when(auth.consentedUser(request)).thenReturn(
                new AuthenticatedUser(USER_ID, "report@test", UserStatus.ACTIVE));
        when(reportSource.getOwnedReportSource(USER_ID, SESSION_ID)).thenReturn(source());
        when(syncOperations.requestId(any())).thenReturn(CLAIM.requestId());
        when(syncOperations.fingerprint(anyString(), any())).thenReturn("0".repeat(64));
        when(syncOperations.begin(any(), any(), any(), anyString(), anyString()))
                .thenReturn(SyncOperationBegin.claimed(CLAIM));
        when(syncOperations.now()).thenReturn(Instant.parse("2026-08-12T00:00:00Z"));
        when(responses.ok(any(), any())).thenReturn(ResponseEntity.ok(new byte[0]));
    }

    @Test
    void existingReportCompletesOnlyTheOperationWithoutCallingLlm() throws Exception {
        JsonNode existing = mapper.readTree("""
                {"report_type":"analysis","title":"이미 생성됨"}
                """);
        when(reportSource.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(existing);

        controller.create(new ReportReq(SESSION_ID), null, request);

        verify(reportEngine, never()).generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any());
        verify(syncOperations).complete(
                org.mockito.ArgumentMatchers.eq(CLAIM),
                org.mockito.ArgumentMatchers.eq(existing));
        verify(reportOperations, never()).completePracticeReportOperation(
                any(), any(), any(), anyString(), any(), any(), any(), any());
    }

    @Test
    void parseFailureIs502AndMarksReportOperationWithSharedErrorCode() {
        when(reportSource.getPracticeReportForHandoff(HANDOFF_ID)).thenReturn(null);
        when(reportEngine.generateReport(any(), any(), any(),
                org.mockito.ArgumentMatchers.anyBoolean(), any(), any(), any()))
                .thenThrow(new ReportParseError("bad report"));

        assertThatThrownBy(() -> controller.create(new ReportReq(SESSION_ID), null, request))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(502);
                    assertThat(exception.getMessage()).isEqualTo("bad report");
                });

        verify(syncOperations).fail(CLAIM, "report_parse_error");
    }

    private OwnedReportSource source() {
        return new OwnedReportSource(
                PRACTICE_ID,
                SESSION_ID,
                emptyPack(),
                "analysis",
                HANDOFF_ID,
                mapper.createObjectNode().put("handoff_type", "analysis"),
                true,
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
