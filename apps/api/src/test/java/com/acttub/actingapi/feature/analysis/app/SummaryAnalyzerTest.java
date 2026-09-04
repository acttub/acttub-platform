package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.observation.ObservationPack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 분석은 duration → 압축 → 관찰 세 걸음이다.
 *
 * <p>네 번째 걸음이던 받아쓰기는 SOMA-490 에서 사라졌다 — 영상을 보는 모델이 소리도 함께
 * 듣고 대사를 {@code quote} 로 담으므로, 같은 오디오를 다른 모델에 또 보낼 이유가 없다.
 */
class SummaryAnalyzerTest {

    @TempDir
    Path temporary;

    @Test
    void resolvesDurationThenCompressesAndObserves() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path compressed = Files.writeString(temporary.resolve("take.gemini.mp4"), "small");
        List<String> order = new ArrayList<>();

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> { order.add("duration"); return 3210; },
                path -> { order.add("compress"); return compressed; },
                (path, mime, actor) -> {
                    order.add("observe");
                    assertThat(path).isEqualTo(compressed);
                    assertThat(actor.durationMs()).isEqualTo(3210);
                    return new ObservationPack("장면 요약", List.of(), List.of());
                });

        AnalysisResult result = analyzer.analyze(video, context("분석", null));

        assertThat(order).containsExactly("duration", "compress", "observe");
        assertThat(result.wasCompressed()).isTrue();
        assertThat(result.observationPack().sceneSummary()).isEqualTo("장면 요약");
        assertThat(compressed).doesNotExist();
    }

    /** 압축이 원본을 그대로 돌려주면 지울 것이 없고, 압축했다고 말하지도 않는다. */
    @Test
    void uncompressedVideoIsReportedAsSuchAndKept() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack("", List.of(), List.of("불확실")));

        AnalysisResult result = analyzer.analyze(video, context("표현", 1000));

        assertThat(result.wasCompressed()).isFalse();
        assertThat(result.observationPack().uncertainties()).containsExactly("불확실");
        assertThat(video).exists();
    }

    private static AnalysisContext context(String blockageKind, Integer durationMs) {
        return new AnalysisContext(
                null, null, "users/u/uploads/take.mp4", "video/mp4", "etag",
                durationMs, "상황", "인물", "목표", blockageKind, "세부");
    }
}
