package com.acttub.actingapi.feature.audition.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * 오디션 공고 모아보기(app.audition). 켜진 출처를 하루 두 번 모아 두고, 앱에는 지금 지원할 수 있는 공고를 마감이
 * 가까운 순으로 준다.
 */
public final class AuditionService {

    private static final Logger LOGGER = Logger.getLogger(AuditionService.class.getName());

    /** 수집 주기(12시간)를 넘겨 비어 있었으면 기동 직후 한 번 모은다. */
    static final Duration STALE_AFTER = Duration.ofHours(12);

    private final AuditionSettings settings;
    private final AuditionSources sources;
    private final AuditionRepository postings;
    private final FailureReporter failures;
    private final Clock clock;
    private final AtomicBoolean collecting = new AtomicBoolean();

    public AuditionService(AuditionSettings settings, AuditionSources sources, AuditionRepository postings,
            FailureReporter failures, Clock clock) {
        this.settings = settings;
        this.sources = sources;
        this.postings = postings;
        this.failures = failures;
        this.clock = clock;
    }

    public record AuditionList(List<AuditionPosting> items, Instant collectedAt) {
    }

    /** 수집 한 번의 결과. 출처마다 저장한 수, 실패한 출처, 지운 행 수. */
    public record CollectResult(List<String> stored, List<String> failed, int deleted) {
    }

    /** 지금 지원할 수 있는 공고 전부. 꺼진 서버는 빈 목록이다. */
    public AuditionList list() {
        if (!settings.enabled()) {
            return new AuditionList(List.of(), null);
        }
        LocalDate today = today();
        List<AuditionPosting> open = postings.openCandidates(today).stream()
                .filter(posting -> AuditionRules.isOpen(posting, today))
                .sorted(AuditionRules.ORDER)
                .toList();
        return new AuditionList(open, postings.lastCollectedAt().orElse(null));
    }

    /**
     * 켜진 출처를 차례로 모아 저장하고 끝에 삭제 규칙을 돌린다. 출처 하나가 실패해도 나머지는 계속하고, 0건이 나온
     * 출처의 기존 행은 건드리지 않는다. 이메일·휴대폰 번호 모양이 있는 공고는 저장하지 않는다. 이미 도는 중이면
     * 아무것도 하지 않는다.
     */
    public CollectResult collect() {
        if (!settings.enabled() || !collecting.compareAndSet(false, true)) {
            return new CollectResult(List.of(), List.of(), 0);
        }
        try {
            LocalDate today = today();
            List<String> stored = new ArrayList<>();
            List<String> failed = new ArrayList<>();
            for (String source : settings.sources()) {
                List<AuditionPosting> read;
                try {
                    read = sources.read(source, today);
                } catch (RuntimeException failure) {
                    failed.add(source);
                    failures.report(failure, FailureKind.EXTERNAL,
                            new FailureContext("AuditionService.collect." + source));
                    continue;
                }
                List<AuditionPosting> kept = read.stream()
                        .filter(posting -> source.equals(posting.source()))
                        .filter(posting -> !AuditionRules.containsPersonalContact(posting))
                        .toList();
                if (kept.size() < read.size()) {
                    LOGGER.info("audition " + source + ": dropped " + (read.size() - kept.size())
                            + " postings with contact-like text");
                }
                if (!kept.isEmpty()) {
                    postings.upsert(kept, clock.instant().truncatedTo(ChronoUnit.MICROS));
                }
                stored.add(source + "=" + kept.size());
            }
            int deleted = postings.deleteExpired(today);
            LOGGER.info("audition collect: " + stored + " failed=" + failed + " deleted=" + deleted);
            return new CollectResult(List.copyOf(stored), List.copyOf(failed), deleted);
        } finally {
            collecting.set(false);
        }
    }

    /** 한 번도 모으지 않았거나 마지막 수집이 12시간보다 오래됐으면 지금 모은다(기동 직후). */
    public boolean collectIfStale() {
        if (!settings.enabled()) {
            return false;
        }
        boolean stale = postings.lastCollectedAt()
                .map(last -> last.isBefore(clock.instant().minus(STALE_AFTER)))
                .orElse(true);
        if (stale) {
            collect();
        }
        return stale;
    }

    private LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), AuditionRules.KST);
    }
}
