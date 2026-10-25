package com.acttub.actingapi.feature.feedback.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 하루 한 번의 시트 동기화 — 묶음이 가득 차면 다음 묶음을 보고, 시트가 죽었으면 같은 묶음을 돌지 않는다. */
class ExitSurveySyncTest {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");

    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final List<ExitSurveyStore.SheetRow> waiting = new ArrayList<>();
    private final List<UUID> synced = new ArrayList<>();
    private boolean purgeFails;

    private final ExitSurveyStore store = new ExitSurveyStore() {
        @Override
        public boolean ownsPractice(UUID userId, UUID practiceId) {
            return false;
        }

        @Override
        public Accepted submit(NewSurvey survey, Instant now) {
            throw new AssertionError("sync does not accept surveys");
        }

        @Override
        public boolean asked(UUID userId) {
            return false;
        }

        @Override
        public boolean claimAsk(UUID userId, Instant now) {
            return false;
        }

        @Override
        public List<SheetRow> pendingSheetRows(int limit) {
            return List.copyOf(waiting.subList(0, Math.min(limit, waiting.size())));
        }

        @Override
        public void markSheetSynced(UUID id, int seq, Instant now) {
            synced.add(id);
            waiting.removeIf(row -> row.id().equals(id));
        }

        @Override
        public int purgeExpiredContacts(Instant acceptedBefore, Instant now) {
            if (purgeFails) {
                throw new IllegalStateException("purge failed");
            }
            return 0;
        }
    };

    private static ExitSurveyStore.SheetRow row(int index) {
        return new ExitSurveyStore.SheetRow(UUID.randomUUID(), 1, UUID.randomUUID(), null, "library", "manual",
                "의견 " + index, null, null, NOW);
    }

    private ExitSurveySync sync(ExitSurveySheet sheet) {
        return new ExitSurveySync(store, sheet, reporter, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void fullBatchesAreFollowedByTheNextBatchUntilTheQueueIsEmpty() {
        IntStream.range(0, 150).forEach(index -> waiting.add(row(index)));

        int sent = sync(row -> { }).runDaily();

        assertThat(sent).isEqualTo(150);
        assertThat(synced).hasSize(150);
        assertThat(waiting).isEmpty();
    }

    @Test
    void deadSheetStopsAfterOneBatchAndAFailedPurgeIsReportedWithoutStoppingTheSync() {
        IntStream.range(0, 100).forEach(index -> waiting.add(row(index)));
        purgeFails = true;

        int sent = sync(row -> {
            throw new IllegalStateException("sheet down");
        }).runDaily();

        assertThat(sent).isZero();
        assertThat(waiting).hasSize(100);
        assertThat(reporter.contexts()).first().isEqualTo("ExitSurveySync.purgeContacts");
    }

    @Test
    void sheetNotConfiguredSendsNothingAndReportsNothingButKeepsRows() {
        IntStream.range(0, 3).forEach(index -> waiting.add(row(index)));
        ExitSurveySheet notConfigured = new ExitSurveySheet() {
            @Override
            public void upsert(ExitSurveyStore.SheetRow row) {
                throw new AssertionError("시트가 없으면 보내지 않는다");
            }

            @Override
            public boolean configured() {
                return false;
            }
        };

        int sent = sync(notConfigured).runDaily();

        assertThat(sent).isZero();
        assertThat(waiting).hasSize(3);
        assertThat(reporter.contexts()).doesNotContain("ExitSurveySync.upsert");
    }
}
