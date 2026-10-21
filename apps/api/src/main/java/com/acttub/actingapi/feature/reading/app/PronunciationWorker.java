package com.acttub.actingapi.feature.reading.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
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
 */
public class PronunciationWorker {
    private static final Logger LOGGER = Logger.getLogger(PronunciationWorker.class.getName());

    private final PronunciationReportRepository reports;
    private final PronunciationScorer scorer;
    private final PronunciationAudio audio;
    private final PronunciationSettings settings;
    private final Clock clock;

    public PronunciationWorker(PronunciationReportRepository reports, PronunciationScorer scorer, PronunciationAudio audio,
            PronunciationSettings settings, Clock clock) {
        this.reports = reports;
        this.scorer = scorer;
        this.audio = audio;
        this.settings = settings;
        this.clock = clock;
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
            for (LineSource line : reports.lines(claimed.sessionId())) {
                if (line.transcript() == null || line.transcript().isBlank()) {
                    inputs.add(new LineInput(line.lineNo(), line.text(), null, null));
                    continue;
                }
                Scored scored = score(line);
                model = scored.modelVersion();
                inputs.add(new LineInput(line.lineNo(), line.text(), line.transcript(), scored.line()));
            }
            Report report = PronunciationRules.build(inputs);
            if (!reports.complete(claimed.reportId(), token, report.empty() ? "skipped" : "done", model, report, clock.instant())) {
                LOGGER.warning("pronunciation lease ownership was lost: " + claimed.reportId());
            }
        } catch (RuntimeException | IOException failure) {
            boolean retry = claimed.attempt() < settings.maxAttempts();
            reports.fail(claimed.reportId(), token, failure.getClass().getSimpleName(), retry, clock.instant());
            if (failure instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new IllegalStateException(failure);
        }
        return true;
    }

    private Scored score(LineSource line) throws IOException {
        Path temp = Files.createTempFile("pron-", ".m4a");
        try {
            audio.download(line.objectKey(), temp);
            return scorer.score(temp, line.contentType(), line.text());
        } finally {
            Files.deleteIfExists(temp);
        }
    }
}
