package com.acttub.actingapi.feature.appversion.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class MinimumRaiseTest {

    private static final Duration SETTLE = Duration.ofHours(6);
    private static final Instant SEEN = Instant.parse("2026-12-01T00:00:00Z");
    private static final Instant SETTLED = SEEN.plus(SETTLE);

    private static AppVersion v(String text) {
        return AppVersion.parse(text).orElseThrow();
    }

    @Test
    void 마이너가_오르면_스토어_판의_x_y_0으로_올린다() {
        assertThat(MinimumRaise.next(v("1.1.0"), v("1.2.1"), SEEN, SETTLED, SETTLE)).contains(v("1.2.0"));
        assertThat(MinimumRaise.next(v("1.9.0"), v("2.0.0"), SEEN, SETTLED, SETTLE)).contains(v("2.0.0"));
    }

    @Test
    void 패치만_바뀌면_그대로다() {
        assertThat(MinimumRaise.next(v("1.2.0"), v("1.2.1"), SEEN, SETTLED, SETTLE)).isEmpty();
        assertThat(MinimumRaise.next(v("1.2.0"), v("1.2.0"), SEEN, SETTLED, SETTLE)).isEmpty();
    }

    @Test
    void 아직_올린_적이_없으면_스토어_판의_x_y_0으로_올린다() {
        assertThat(MinimumRaise.next(null, v("1.1.2"), SEEN, SETTLED, SETTLE)).contains(v("1.1.0"));
    }

    @Test
    void 스토어에_보인_지_정한_시간이_안_지났으면_기다린다() {
        assertThat(MinimumRaise.next(v("1.1.0"), v("1.2.0"), SEEN, SETTLED.minusSeconds(1), SETTLE)).isEmpty();
        assertThat(MinimumRaise.next(v("1.1.0"), v("1.2.0"), null, SETTLED, SETTLE)).isEmpty();
    }

    @Test
    void 스토어_판이_내려가도_최소_판은_내리지_않는다() {
        assertThat(MinimumRaise.next(v("1.2.0"), v("1.1.9"), SEEN, SETTLED, SETTLE)).isEmpty();
    }

    @Test
    void 올리는_값은_스토어_판보다_높을_수_없다() {
        for (String store : new String[] {"1.2.0", "1.2.9", "3.0.1"}) {
            assertThat(MinimumRaise.next(null, v(store), SEEN, SETTLED, SETTLE))
                    .hasValueSatisfying(raised -> assertThat(raised).isLessThanOrEqualTo(v(store)));
        }
    }
}
