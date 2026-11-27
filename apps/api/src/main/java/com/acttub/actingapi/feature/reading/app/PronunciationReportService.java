package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Predicate;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.ReportState;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 발음 보고서 조회(SOMA-606, 실험). 끝난 회차를 처음 조회하면 채점을 큐에 넣는다 — 리딩 흐름(진행 저장)은 건드리지 않는다.
 * 앱은 리딩이 끝나면 이 조회를 부르고 {@code queued}·{@code running} 이면 잠시 뒤 다시 부른다.
 *
 * <p>발음 보고서는 Pro 혜택이다. 결제했거나 서버가 준 Pro 기간 안인 회원과, 허용 사용자 목록에 있는
 * 사람만 받는다. 그 밖은 404 {@code pronunciation_not_available}.
 *
 * <p><b>만드는 중이면 답을 잠시 붙잡는다</b>(SOMA-1169). 앱(1.1.x)은 4초마다 45번(약 3분)만 묻고 멈추는데, 긴 리딩은 채점이
 * 9분 가까이 걸린다(11/25 운영, 88줄 넘는 회차 528초). 그래서 {@code queued}·{@code running} 이면 1초마다 다시 보며
 * {@code hold}(기본 10초, 앱의 한 번 묻기 시한 15초 안)까지 기다렸다가 답한다 — 앱 업데이트 없이 앱이 약 10분까지 기다리게 되고,
 * 다 되면 1초 안에 답이 간다. {@code hold} 가 0이면 예전처럼 바로 답한다.
 */
public class PronunciationReportService {

    /** 붙잡는 동안 다시 보는 간격. */
    static final Duration STEP = Duration.ofSeconds(1);

    /** 기다리기. 운영은 {@link Thread#sleep(Duration)} 이다. */
    @FunctionalInterface
    public interface Pause {
        void sleep(Duration duration) throws InterruptedException;
    }

    private final PronunciationReportRepository reports;
    private final PronunciationSettings settings;
    private final Predicate<UUID> pro;
    private final Clock clock;
    private final Duration hold;
    private final Pause pause;

    public PronunciationReportService(PronunciationReportRepository reports, PronunciationSettings settings, Predicate<UUID> pro,
            Clock clock, Duration hold, Pause pause) {
        this.reports = reports;
        this.settings = settings;
        this.pro = pro;
        this.clock = clock;
        this.hold = hold.isNegative() ? Duration.ZERO : hold;
        this.pause = pause;
    }

    public ReportState find(UUID userId, UUID sessionId) {
        if (!settings.running() || !(settings.allows(userId) || pro.test(userId))) {
            throw new ApiException(404, "pronunciation_not_available");
        }
        ReportState state = lookup(userId, sessionId);
        Instant deadline = clock.instant().plus(hold);
        while (waiting(state) && clock.instant().isBefore(deadline)) {
            Duration left = Duration.between(clock.instant(), deadline);
            try {
                pause.sleep(left.compareTo(STEP) < 0 ? left : STEP);
            } catch (InterruptedException interrupted) {
                // 서버가 내려가는 중이다. 지금 상태로 답하고 끊김은 되살려 둔다.
                Thread.currentThread().interrupt();
                return state;
            }
            state = lookup(userId, sessionId);
        }
        return state;
    }

    private ReportState lookup(UUID userId, UUID sessionId) {
        ReportState state = reports.findOrEnqueue(userId, sessionId, clock.instant());
        if (state == null) {
            throw new ApiException(404, "session_not_found");
        }
        return state;
    }

    private static boolean waiting(ReportState state) {
        return "queued".equals(state.status()) || "running".equals(state.status());
    }
}
