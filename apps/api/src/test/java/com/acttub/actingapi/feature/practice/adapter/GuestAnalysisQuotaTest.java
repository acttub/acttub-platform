package com.acttub.actingapi.feature.practice.adapter;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.LegacyPracticeReader;
import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class GuestAnalysisQuotaTest {
    @ParameterizedTest
    @CsvSource({"default,true,3", "true,true,3", "false,true,0", "default,false,0"})
    void environmentControlsCreationContinuationAndReanalysis(String enabled, boolean guest, int expectedLimit) {
        var practices = mock(PracticeRepository.class, invocation -> {
            if (invocation.getMethod().getReturnType() == PracticeRepository.Started.class) {
                return new PracticeRepository.Started(PracticeRepository.StartOutcome.NOT_FOUND, null);
            }
            return RETURNS_DEFAULTS.answer(invocation);
        });
        UUID user = UUID.randomUUID();
        var runner = new ApplicationContextRunner()
                .withUserConfiguration(PracticeConfiguration.class)
                .withBean(PracticeRepository.class, () -> practices)
                .withBean(LegacyPracticeReader.class, () -> mock(LegacyPracticeReader.class))
                .withBean(Clock.class, () -> Clock.fixed(Instant.parse("2026-09-21T04:00:00Z"), ZoneOffset.UTC));
        if (!enabled.equals("default")) {
            runner = runner.withPropertyValues("ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=" + enabled);
        }
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            var service = context.getBean(PracticeService.class);
            var draft = new PracticeService.Draft(UUID.randomUUID(), UUID.randomUUID(),
                    "", "", "", "그 외", "그 외", null);
            assertThatThrownBy(() -> service.start(user, guest, "three_layers_v1", draft))
                    .isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> service.continueGroup(user, guest, "three_layers_v1", UUID.randomUUID(), draft))
                    .isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> service.retryAnalysis(user, guest, UUID.randomUUID(), UUID.randomUUID()))
                    .isInstanceOf(ApiException.class);
            var requests = mockingDetails(practices).getInvocations();
            assertThat(requests).hasSize(3);
            for (var request : requests) {
                Object[] arguments = request.getArguments();
                var quota = (PracticeRepository.Quota) arguments[arguments.length - 2];
                if (expectedLimit == 0) assertThat(quota).isNull();
                else {
                    assertThat(quota.limit()).isEqualTo(3);
                    assertThat(quota.since()).isEqualTo(Instant.parse("2026-09-20T15:00:00Z"));
                }
            }
        });
    }
}
