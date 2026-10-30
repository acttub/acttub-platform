package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;

import org.junit.jupiter.api.Test;

/** ffmpeg astats 의 누적 최댓값을 읽는다 — 마지막 프레임 값이 전체 최댓값이다. */
class AudioPeakTest {

    @Test
    void readsTheLastCumulativePeak() throws IOException {
        String printed = """
                frame:0    pts:0       pts_time:0
                lavfi.astats.Overall.Peak_level=-48.120000
                frame:1    pts:1024    pts_time:0.064
                lavfi.astats.Overall.Peak_level=-12.500000
                """;
        assertThat(AudioPeak.lastPeak(new BufferedReader(new StringReader(printed)))).isEqualTo(-12.5);
    }

    @Test
    void digitalSilenceIsNegativeInfinity() throws IOException {
        String printed = "frame:0\nlavfi.astats.Overall.Peak_level=-inf\n";
        assertThat(AudioPeak.lastPeak(new BufferedReader(new StringReader(printed)))).isEqualTo(Double.NEGATIVE_INFINITY);
    }

    @Test
    void noMeasurementIsAFailure() {
        assertThatThrownBy(() -> AudioPeak.lastPeak(new BufferedReader(new StringReader("frame:0\n"))))
                .isInstanceOf(IOException.class);
    }
}
