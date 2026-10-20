package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** challenge.browse: 목록 커서는 같은 요청자·탭·검색에서만 다시 쓰고, 고친 값은 거절한다. 리포트 출력도 형식이 맞아야 쓴다. */
class ChallengeCursorTest {
    final UUID viewer = UUID.randomUUID();
    final UUID card = UUID.randomUUID();

    static String b64(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    String raw(String version, String tab, UUID who, String search, String at, String likes, String entries) {
        return b64(String.join("|", version, tab, who.toString(), b64(search), at, card.toString(), likes, entries));
    }

    @Test void aCursorDecodesOnlyForTheSameScope() {
        assertThat(ChallengeCursor.decode(null, "popular", viewer, "")).isNull();
        assertThat(ChallengeCursor.decode(" ", "popular", viewer, "")).isNull();
        assertThat(ChallengeCursor.decode(raw("1", "popular", viewer, "가지", "2026-10-01T00:00:00Z", "3", "4"), "popular", viewer, "가지"))
                .isEqualTo(new ChallengeCursor(Instant.parse("2026-10-01T00:00:00Z"), card, 3, 4));
        assertThatThrownBy(() -> ChallengeCursor.decode("a".repeat(4097), "popular", viewer, "")).hasMessage("cursor too long");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("2", "popular", viewer, "", "2026-10-01T00:00:00Z", "0", "0"), "popular", viewer, ""))
                .hasMessage("cursor scope changed");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "latest", viewer, "", "2026-10-01T00:00:00Z", "0", "0"), "popular", viewer, ""))
                .hasMessage("cursor scope changed");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", UUID.randomUUID(), "", "2026-10-01T00:00:00Z", "0", "0"), "popular", viewer, ""))
                .hasMessage("cursor scope changed");
        assertThatThrownBy(() -> ChallengeCursor.decode(b64("1|popular"), "popular", viewer, "")).hasMessage("cursor scope changed");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", viewer, "가지", "2026-10-01T00:00:00Z", "0", "0"), "popular", viewer, "돌아와"))
                .hasMessage("cursor search changed");
    }

    @Test void tamperedCountsOrDatesAreRejected() {
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", viewer, "", "2026-10-01T00:00:00Z", "-1", "0"), "popular", viewer, ""))
                .hasMessage("invalid cursor counts");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", viewer, "", "2026-10-01T00:00:00Z", "0", "-1"), "popular", viewer, ""))
                .hasMessage("invalid cursor counts");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", viewer, "", "-1000000-01-01T00:00:00Z", "0", "0"), "popular", viewer, ""))
                .hasMessage("invalid cursor date");
        assertThatThrownBy(() -> ChallengeCursor.decode(raw("1", "popular", viewer, "", "+1000000-01-01T00:00:00Z", "0", "0"), "popular", viewer, ""))
                .hasMessage("invalid cursor date");
    }

    @Test void reportOutputNeedsUsableObservationsAndIgnoresBlankParts() {
        assertThatThrownBy(() -> ChallengeReportParser.parse("{broken", Map.of())).hasMessage("report output is not JSON");
        assertThatThrownBy(() -> ChallengeReportParser.parse(null, Map.of())).hasMessage("report output is not an object");
        assertThatThrownBy(() -> ChallengeReportParser.parse("[1]", Map.of())).hasMessage("report output is not an object");
        assertThatThrownBy(() -> ChallengeReportParser.parse("""
                {"observations":[{"start_ms":5,"end_ms":1,"text":"거꾸로"},{"start_ms":-1,"end_ms":1,"text":"음수"},{"start_ms":0,"end_ms":1,"text":"null"}]}
                """, Map.of())).hasMessage("report has no observation");
        var labels = Map.of("A", UUID.randomUUID(), "B", UUID.randomUUID(), "C", UUID.randomUUID());
        var result = ChallengeReportParser.parse("""
                {"observations":[{"start_ms":0,"end_ms":1000,"text":"첫 마디가 짧다"}],
                 "comparisons":[{"text":"  ","samples":["A"]},{"text":"표본보다 짧다","samples":["A","A","Z"]},{"text":"표본 없음","samples":["Z"]}],
                 "limits":[7, "  ", "소리가 작다"], "suggestion":" "}
                """, labels);
        assertThat(result.comparisons()).hasSize(1);
        assertThat(result.comparisons().getFirst().text()).isEqualTo("표본보다 짧다");
        assertThat(result.comparisons().getFirst().samples()).containsExactly(labels.get("A"));
        assertThat(result.limits()).containsExactly("소리가 작다");
        assertThat(result.suggestion()).isNull();
    }
}
