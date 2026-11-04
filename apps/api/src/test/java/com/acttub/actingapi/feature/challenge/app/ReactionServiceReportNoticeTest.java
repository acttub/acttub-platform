package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReport;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReportPage;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.Filed;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.NewReport;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.Receipt;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 새 사람 신고만 팀에 알리고, 같은 신고의 재전송은 알리지 않는다(SOMA-1042). */
class ReactionServiceReportNoticeTest {
    private static final UUID REPORTER = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    private static final UUID TARGET = UUID.fromString("00000000-0000-0000-0000-00000000000b");
    private static final UUID REPORT = UUID.fromString("00000000-0000-0000-0000-00000000000c");

    private static ReportRepository repository(Filed result) {
        return new ReportRepository() {
            @Override public Filed file(UUID reporter, UUID requestId, String fingerprint, NewReport report, Instant now) { return result; }
            @Override public AdminReportPage list(String status, String cursor) { throw new UnsupportedOperationException(); }
            @Override public AdminReport resolve(UUID id, String resolution, String reviewer, String note, Instant now) {
                throw new UnsupportedOperationException();
            }
        };
    }

    private static List<ReportNotifier.Notice> file(Filed result, String note) {
        List<ReportNotifier.Notice> sent = new ArrayList<>();
        ReactionService service = new ReactionService(null, repository(result), new CanonicalJson(new ObjectMapper()),
                Clock.fixed(Instant.parse("2026-11-04T07:00:00Z"), ZoneOffset.UTC), sent::add);
        service.report(REPORTER, UUID.randomUUID(), "challenge", TARGET, "copyright", note);
        return sent;
    }

    @Test
    void newReportIsSentWithTargetTextAndWithoutReporter() {
        List<ReportNotifier.Notice> sent = file(new Filed(new Receipt(REPORT, "received"), true, "대사 한 줄"), "  드라마 대사예요 ");
        assertThat(sent).singleElement().satisfies(n -> {
            assertThat(n.id()).isEqualTo(REPORT);
            assertThat(n.targetType()).isEqualTo("challenge");
            assertThat(n.targetId()).isEqualTo(TARGET);
            assertThat(n.reason()).isEqualTo("copyright");
            assertThat(n.note()).isEqualTo("드라마 대사예요");
            assertThat(n.targetText()).isEqualTo("대사 한 줄");
        });
    }

    @Test
    void replayIsNotSentAgain() {
        assertThat(file(new Filed(new Receipt(REPORT, "received"), false), null)).isEmpty();
    }
}
