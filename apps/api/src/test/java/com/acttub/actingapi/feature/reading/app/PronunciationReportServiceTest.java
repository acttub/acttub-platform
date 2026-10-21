package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class PronunciationReportServiceTest {
    private static final UUID ALLOWED = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-21T00:00:00Z"), ZoneOffset.UTC);

    private static PronunciationReportService service(boolean enabled, String url, PronunciationReportRepository.ReportState state) {
        PronunciationReportRepository repo = new PronunciationReportRepository() {
            @Override
            public ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now) {
                return state;
            }

            @Override
            public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
                return null;
            }

            @Override
            public List<LineSource> lines(UUID sessionId) {
                return List.of();
            }

            @Override
            public boolean complete(UUID reportId, UUID leaseToken, String status, String modelVersion, Report report, Instant now) {
                return false;
            }

            @Override
            public boolean fail(UUID reportId, UUID leaseToken, String failure, boolean retry, Instant now) {
                return false;
            }
        };
        return new PronunciationReportService(repo,
                new PronunciationSettings(enabled, Set.of(ALLOWED), url, Duration.ofMinutes(10), 3), CLOCK);
    }

    @Test
    void 꺼져_있거나_허용_목록_밖이거나_채점_주소가_없으면_404() {
        var state = new PronunciationReportRepository.ReportState("queued", null);
        assertThatThrownBy(() -> service(false, "http://pron:8000", state).find(ALLOWED, SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("pronunciation_not_available");
        assertThatThrownBy(() -> service(true, "http://pron:8000", state).find(UUID.randomUUID(), SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("pronunciation_not_available");
        assertThatThrownBy(() -> service(true, "", state).find(ALLOWED, SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("pronunciation_not_available");
    }

    @Test
    void 내_회차가_아니면_404_session_not_found() {
        assertThatThrownBy(() -> service(true, "http://pron:8000", null).find(ALLOWED, SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("session_not_found");
    }

    @Test
    void 허용_사용자는_상태를_받는다() {
        var state = new PronunciationReportRepository.ReportState("queued", null);
        assertThat(service(true, "http://pron:8000", state).find(ALLOWED, SESSION).status()).isEqualTo("queued");
    }
}
