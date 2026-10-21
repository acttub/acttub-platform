package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Phone;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Word;
import org.junit.jupiter.api.Test;

/** 발음 보고서 일꾼: 집은 회차의 줄을 채점해 닫고, 실패는 시도 수에 따라 다시 줄 세우거나 실패로 닫는다(SOMA-606). */
class PronunciationWorkerTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-21T00:00:00Z"), ZoneOffset.UTC);
    private static final UUID REPORT = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();

    /** 줄과 집을 것을 정해 두고, 닫은 결과를 적어 두는 가짜 장부. */
    static final class FakeReports implements PronunciationReportRepository {
        Claimed next;
        List<LineSource> lines = List.of();
        boolean leaseHeld = true;
        String completedStatus;
        String completedModel;
        Report completedReport;
        String failure;
        Boolean retried;

        @Override
        public ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now) {
            return null;
        }

        @Override
        public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
            Claimed claimed = next;
            next = null;
            return claimed;
        }

        @Override
        public List<LineSource> lines(UUID sessionId) {
            return lines;
        }

        @Override
        public boolean complete(UUID reportId, UUID leaseToken, String status, String modelVersion, Report report, Instant now) {
            completedStatus = status;
            completedModel = modelVersion;
            completedReport = report;
            return leaseHeld;
        }

        @Override
        public boolean fail(UUID reportId, UUID leaseToken, String failure, boolean retry, Instant now) {
            this.failure = failure;
            this.retried = retry;
            return true;
        }
    }

    final FakeReports reports = new FakeReports();
    final List<String> downloaded = new ArrayList<>();
    final List<String> scoredTexts = new ArrayList<>();
    final List<Path> tempFiles = new ArrayList<>();
    RuntimeException scorerFailure;
    String failOnlyText;

    private PronunciationWorker worker(int maxAttempts) {
        PronunciationAudio audio = (key, destination) -> {
            downloaded.add(key);
            tempFiles.add(destination);
        };
        PronunciationScorer scorer = (path, contentType, text) -> {
            assertThat(Files.exists(path)).as("채점하는 동안 임시 파일이 있다").isTrue();
            if (scorerFailure != null && (failOnlyText == null || failOnlyText.equals(text))) {
                throw scorerFailure;
            }
            scoredTexts.add(text);
            Phone phone = new Phone("ㄷ", "ㄷ", 1.0, false, 0, 0, 100, false);
            return new PronunciationScorer.Scored(new ScoredLine(text, List.of(new Word(0, text, false, List.of(phone)))), "pron-test");
        };
        return new PronunciationWorker(reports, scorer, audio,
                new PronunciationSettings(true, Set.of(), "http://pron.test", Duration.ofMinutes(10), maxAttempts), CLOCK);
    }

    private static PronunciationReportRepository.LineSource line(int no, String text, String transcript) {
        return line(no, text, transcript, 3_000);
    }

    private static PronunciationReportRepository.LineSource line(int no, String text, String transcript, Integer durationMs) {
        return new PronunciationReportRepository.LineSource(no, text, transcript, "rec/" + no, "audio/mp4", durationMs);
    }

    @Test
    void 집을_것이_없으면_false() {
        assertThat(worker(3).runOnce()).isFalse();
        assertThat(reports.completedStatus).isNull();
    }

    @Test
    void 받아쓴_글이_있는_줄만_채점해_done_으로_닫고_임시_파일은_지운다() {
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", "다리"), line(3, "머리", null), line(5, "허리", " "));

        assertThat(worker(3).runOnce()).isTrue();

        assertThat(downloaded).containsExactly("rec/1");
        assertThat(scoredTexts).containsExactly("다리");
        assertThat(tempFiles).allSatisfy(path -> assertThat(Files.exists(path)).isFalse());
        assertThat(reports.completedStatus).isEqualTo("done");
        assertThat(reports.completedModel).isEqualTo("pron-test");
        assertThat(reports.completedReport.summary().linesUsed()).isEqualTo(1);
        assertThat(reports.completedReport.skippedLines()).containsExactly(3, 5);
    }

    @Test
    void 쓸_줄이_하나도_없으면_skipped_로_닫는다() {
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", null));

        assertThat(worker(3).runOnce()).isTrue();

        assertThat(scoredTexts).isEmpty();
        assertThat(reports.completedStatus).isEqualTo("skipped");
        assertThat(reports.completedModel).isNull();
    }

    @Test
    void 임대를_잃어도_던지지_않는다() {
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", "다리"));
        reports.leaseHeld = false;

        assertThat(worker(3).runOnce()).isTrue();
        assertThat(reports.failure).isNull();
    }

    @Test
    void 채점이_실패하면_시도가_남았을_때만_다시_줄_세우고_예외는_그대로_던진다() {
        scorerFailure = new IllegalStateException("pronunciation scorer returned 500");
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", "다리"));
        assertThatThrownBy(() -> worker(3).runOnce()).isSameAs(scorerFailure);
        assertThat(reports.failure).isEqualTo("IllegalStateException");
        assertThat(reports.retried).isTrue();
        assertThat(reports.completedStatus).isNull();

        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 3);
        assertThatThrownBy(() -> worker(3).runOnce()).isSameAs(scorerFailure);
        assertThat(reports.retried).isFalse();
    }

    @Test
    void 녹음을_받지_못해도_실패로_적는다() {
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", "다리"));
        PronunciationAudio broken = (key, destination) -> {
            throw new UncheckedIOException(new java.io.IOException("storage down"));
        };
        PronunciationWorker worker = new PronunciationWorker(reports, (p, c, t) -> null, broken,
                new PronunciationSettings(true, Set.of(), "http://pron.test", Duration.ofMinutes(10), 3), CLOCK);

        assertThatThrownBy(worker::runOnce).isInstanceOf(UncheckedIOException.class);
        assertThat(reports.failure).isEqualTo("UncheckedIOException");
        assertThat(reports.retried).isTrue();
    }

    @Test
    void 너무_긴_줄은_보내지_않고_빠진_줄로_적는다() {
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(2, "그냥", "나지", 106_830), line(4, "다리", "다리", 20_000), line(6, "머리", "머리", null));

        assertThat(worker(3).runOnce()).isTrue();

        assertThat(downloaded).containsExactly("rec/4", "rec/6");
        assertThat(reports.completedStatus).isEqualTo("done");
        assertThat(reports.completedReport.skippedLines()).containsExactly(2);
        assertThat(reports.completedReport.summary().linesUsed()).isEqualTo(2);
    }

    @Test
    void 줄_하나가_실패해도_나머지로_보고서를_만든다() {
        scorerFailure = new IllegalStateException("pronunciation scorer failed");
        failOnlyText = "머리";
        reports.next = new PronunciationReportRepository.Claimed(REPORT, SESSION, 1);
        reports.lines = List.of(line(1, "다리", "다리"), line(3, "머리", "머리"), line(5, "허리", "허리"));

        assertThat(worker(3).runOnce()).isTrue();

        assertThat(reports.failure).isNull();
        assertThat(reports.completedStatus).isEqualTo("done");
        assertThat(reports.completedReport.skippedLines()).containsExactly(3);
        assertThat(reports.completedReport.summary().linesUsed()).isEqualTo(2);
        assertThat(tempFiles).allSatisfy(path -> assertThat(Files.exists(path)).isFalse());
    }
}
