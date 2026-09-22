package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class GuestAnalysisQuotaTest {
    @ParameterizedTest
    @CsvSource({"default,true,3", "true,true,3", "false,true,0", "default,false,0"})
    void environmentControlsBothCreationPathsAndReanalysis(String enabled, boolean guest, int expectedLimit) {
        var ledger = mock(PracticeSessionLedger.class);
        var sessions = mock(PracticeSessionRepository.class);
        UUID user = UUID.randomUUID();
        UUID upload = UUID.randomUUID();
        when(sessions.uploadExists(user, upload)).thenReturn(true);
        var runner = new ApplicationContextRunner()
                .withUserConfiguration(PracticeSessionService.class)
                .withBean(PracticeSessionLedger.class, () -> ledger)
                .withBean(PracticeSessionRepository.class, () -> sessions)
                .withBean(PracticePlayback.class, () -> mock(PracticePlayback.class))
                .withBean(Clock.class, () -> Clock.fixed(Instant.parse("2026-09-21T04:00:00Z"), ZoneOffset.UTC))
                .withBean(CanonicalJson.class, () -> new CanonicalJson(new ObjectMapper()));
        if (!enabled.equals("default")) {
            runner = runner.withPropertyValues("ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=" + enabled);
        }
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            var service = context.getBean(PracticeSessionService.class);
            var command = new NewPracticeSession(upload, "", "", "", "그 외", "그 외", null, null);
            // The ledger returns no row: test the policy delivered to it without creating data or calling AI.
            assertThatThrownBy(() -> service.create(user, guest, command, UUID.randomUUID()))
                    .isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> service.create(user, guest,
                    command.withExperienceVersion("three_layers_v1"), UUID.randomUUID()))
                    .isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> service.reanalyze(user, guest, UUID.randomUUID(), UUID.randomUUID()))
                    .isInstanceOf(ApiException.class);
            var requests = mockingDetails(ledger).getInvocations();
            assertThat(requests).hasSize(3);
            for (var request : requests) {
                Object[] arguments = request.getArguments();
                var quota = (PracticeSessionLedger.AnalysisQuota) arguments[arguments.length - 1];
                if (expectedLimit == 0) assertThat(quota).isNull();
                else {
                    assertThat(quota.limit()).isEqualTo(3);
                    assertThat(quota.since().toInstant()).isEqualTo(Instant.parse("2026-09-20T15:00:00Z"));
                }
            }
        });
    }
}
