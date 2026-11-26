package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.Test;

class PronunciationReportServiceTest {
    private static final UUID ALLOWED = UUID.randomUUID();
    private static final UUID PRO = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-21T00:00:00Z"), ZoneOffset.UTC);

    private static PronunciationReportService service(boolean enabled, String url, PronunciationReportRepository.ReportState state) {
        return new PronunciationReportService(repo(() -> state),
                new PronunciationSettings(enabled, Set.of(ALLOWED), url, Duration.ofMinutes(10), 3), PRO::equals, CLOCK,
                Duration.ZERO, duration -> { throw new AssertionError("붙잡는 시간이 0이면 기다리지 않는다"); });
    }

    private static PronunciationReportRepository repo(java.util.function.Supplier<PronunciationReportRepository.ReportState> states) {
        return new PronunciationReportRepository() {
            @Override
            public ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now) {
                return states.get();
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

            @Override
            public Optional<ReportOwner> owner(UUID reportId) {
                return Optional.empty();
            }
        };
    }

    /** 만드는 중이면 정한 시간까지 1초씩 쉬며 다시 본다. 쉬는 동안 시계가 그만큼 간다. */
    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-26T00:00:00Z"));
    private final List<Duration> pauses = new ArrayList<>();

    private PronunciationReportService holding(Duration hold, String... statuses) {
        Deque<String> queue = new ArrayDeque<>(List.of(statuses));
        return new PronunciationReportService(
                repo(() -> new PronunciationReportRepository.ReportState(queue.size() > 1 ? queue.poll() : queue.peek(),
                        "done".equals(queue.peek()) ? "{}" : null)),
                new PronunciationSettings(true, Set.of(ALLOWED), "http://pron:8000", Duration.ofMinutes(10), 3), PRO::equals,
                clock, hold, duration -> {
                    pauses.add(duration);
                    clock.advance(duration);
                });
    }

    @Test
    void 만드는_중이면_다_될_때까지_붙잡았다가_바로_준다() {
        var state = holding(Duration.ofSeconds(10), "queued", "running", "running", "done").find(ALLOWED, SESSION);

        assertThat(state.status()).isEqualTo("done");
        assertThat(pauses).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1));
    }

    @Test
    void 정한_시간까지_안_끝나면_만드는_중으로_답한다() {
        var state = holding(Duration.ofSeconds(10), "running").find(ALLOWED, SESSION);

        assertThat(state.status()).isEqualTo("running");
        assertThat(pauses).hasSize(10);
    }

    @Test
    void 끝난_상태와_끝나지_않은_회차는_붙잡지_않는다() {
        assertThat(holding(Duration.ofSeconds(10), "failed").find(ALLOWED, SESSION).status()).isEqualTo("failed");
        assertThat(holding(Duration.ofSeconds(10), "not_ready").find(ALLOWED, SESSION).status()).isEqualTo("not_ready");
        assertThat(holding(Duration.ZERO, "queued").find(ALLOWED, SESSION).status()).isEqualTo("queued");
        assertThat(pauses).isEmpty();
    }

    @Test
    void 기다리는_동안_끊기면_지금_상태로_답하고_끊김을_되살린다() {
        var service = new PronunciationReportService(repo(() -> new PronunciationReportRepository.ReportState("running", null)),
                new PronunciationSettings(true, Set.of(ALLOWED), "http://pron:8000", Duration.ofMinutes(10), 3), PRO::equals,
                clock, Duration.ofSeconds(10), duration -> {
                    throw new InterruptedException("shutdown");
                });
        try {
            assertThat(service.find(ALLOWED, SESSION).status()).isEqualTo("running");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
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

    @Test
    void Pro_회원은_허용_목록에_없어도_받는다() {
        var state = new PronunciationReportRepository.ReportState("queued", null);
        assertThat(service(true, "http://pron:8000", state).find(PRO, SESSION).status()).isEqualTo("queued");
    }

    @Test
    void Pro_회원도_꺼져_있거나_채점_주소가_없으면_404() {
        var state = new PronunciationReportRepository.ReportState("queued", null);
        assertThatThrownBy(() -> service(false, "http://pron:8000", state).find(PRO, SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("pronunciation_not_available");
        assertThatThrownBy(() -> service(true, "", state).find(PRO, SESSION))
                .isInstanceOf(ApiException.class).hasMessageContaining("pronunciation_not_available");
    }
}
