package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.Claimed;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.LineSource;
import com.acttub.actingapi.feature.reading.app.PronunciationScorer.Scored;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.LineInput;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;

/**
 * 발음 보고서 큐를 하나씩 처리한다(SOMA-606). {@code analysis/app/AnalysisWorker} 처럼 임대(lease)로 집고, 채점은
 * 트랜잭션 밖에서 한다. 받아쓴 글이 없는 줄은 채점하지 않는다(어차피 보고서에서 빠진다 — CPU 를 아낀다).
 *
 * <p>줄 하나가 실패해도 보고서 전체를 버리지 않는다. 너무 긴 녹음(대사를 못 하고 기다린 줄 등)은 보내지 않고 빼고,
 * 채점·내려받기에 실패한 줄도 빠진 줄로 적고 나머지로 보고서를 만든다. 보낸 줄이 모두 실패했을 때만(채점 서비스가
 * 죽은 경우 등) 회차를 실패로 적고 다시 줄 세운다.
 *
 * <p>처음 요청부터 {@code notifyAfter}(기본 1분) 넘게 걸려 {@code done} 으로 닫은 보고서는 주인에게 알린다(SOMA-1169) — 긴 리딩은
 * 채점이 몇 분 걸려 배우가 그동안 화면을 떠난다. 금방 끝난 것은 화면에서 이미 봤으니 알리지 않는다.
 */
public class PronunciationWorker {
    private static final Logger LOGGER = Logger.getLogger(PronunciationWorker.class.getName());
    /** 이보다 긴 줄 녹음은 채점하지 않는다. 대사 한 줄에 1분은 넘지 않는다 — 넘으면 대부분 기다린 소리다. */
    static final int MAX_LINE_MS = 60_000;

    private final PronunciationReportRepository reports;
    private final PronunciationScorer scorer;
    private final PronunciationAudio audio;
    private final PronunciationSettings settings;
    private final Clock clock;
    private final PronunciationReportListener listener;
    private final Duration notifyAfter;

    /** @param listener 다 된 보고서를 알릴 곳. 없으면 {@code null} */
    public PronunciationWorker(PronunciationReportRepository reports, PronunciationScorer scorer, PronunciationAudio audio,
            PronunciationSettings settings, Clock clock, PronunciationReportListener listener, Duration notifyAfter) {
        this.reports = reports;
        this.scorer = scorer;
        this.audio = audio;
        this.settings = settings;
        this.clock = clock;
        this.listener = listener;
        this.notifyAfter = notifyAfter;
    }

    /** @return 하나를 집었으면 {@code true} */
    public boolean runOnce() {
        UUID token = UUID.randomUUID();
        Claimed claimed = reports.claimNext(token, settings.lease(), settings.maxAttempts(), clock.instant());
        if (claimed == null) {
            return false;
        }
        try {
            List<LineInput> inputs = new ArrayList<>();
            String model = null;
            int scoredLines = 0;
            Exception lastFailure = null;
            for (LineSource line : reports.lines(claimed.sessionId())) {
                if (line.transcript() == null || line.transcript().isBlank() || tooLong(line)) {
                    inputs.add(new LineInput(line.lineNo(), line.text(), null, null));
                    continue;
                }
                try {
                    Scored scored = score(line);
                    model = scored.modelVersion();
                    scoredLines += 1;
                    inputs.add(new LineInput(line.lineNo(), line.text(), line.transcript(), scored.line()));
                } catch (RuntimeException | IOException failure) {
                    lastFailure = failure;
                    LOGGER.warning("pronunciation line skipped: report=" + claimed.reportId() + " line=" + line.lineNo()
                            + " cause=" + failure);
                    inputs.add(new LineInput(line.lineNo(), line.text(), null, null));
                }
            }
            if (scoredLines == 0 && lastFailure != null) {
                if (lastFailure instanceof IOException io) {
                    throw io;
                }
                throw (RuntimeException) lastFailure;
            }
            Report report = PronunciationRules.build(inputs);
            String status = report.empty() ? "skipped" : "done";
            if (!reports.complete(claimed.reportId(), token, status, model, report, clock.instant())) {
                LOGGER.warning("pronunciation lease ownership was lost: " + claimed.reportId());
            } else if ("done".equals(status)) {
                notifyIfSlow(claimed);
            }
        } catch (RuntimeException | IOException failure) {
            boolean retry = claimed.attempt() < settings.maxAttempts();
            LOGGER.warning("pronunciation report failed: report=" + claimed.reportId() + " attempt=" + claimed.attempt()
                    + " retry=" + retry + " cause=" + failure);
            reports.fail(claimed.reportId(), token, failure.getClass().getSimpleName(), retry, clock.instant());
            if (failure instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new IllegalStateException(failure);
        }
        return true;
    }

    /** 처음 요청부터 {@code notifyAfter} 넘게 걸렸으면 주인에게 알린다. 알림 실패는 로그만 남긴다 — 보고서는 이미 닫혔다. */
    private void notifyIfSlow(Claimed claimed) {
        if (listener == null) {
            return;
        }
        try {
            Instant now = clock.instant();
            reports.owner(claimed.reportId())
                    .filter(owner -> !owner.requestedAt().plus(notifyAfter).isAfter(now))
                    .ifPresent(owner -> listener.onPronunciationReportReady(owner.userId(), claimed.sessionId()));
        } catch (RuntimeException failure) {
            LOGGER.warning("pronunciation report notice failed: report=" + claimed.reportId() + " cause=" + failure);
        }
    }

    private static boolean tooLong(LineSource line) {
        return line.durationMs() != null && line.durationMs() > MAX_LINE_MS;
    }

    private Scored score(LineSource line) throws IOException {
        // 배우의 목소리라 주인만 읽고 쓰게 만든다.
        Path temp = Files.createTempFile("pron-", ".m4a",
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        try {
            audio.download(line.objectKey(), temp);
            return scorer.score(temp, line.contentType(), line.text());
        } finally {
            Files.deleteIfExists(temp);
        }
    }
}
