package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Supplier;

import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class SummaryAnalyzerTest {

    @TempDir
    Path temporary;

    @Test
    void resolvesDurationThenCompressesObservesAndOnlyThenTranscribes() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path compressed = Files.writeString(temporary.resolve("take.gemini.mp4"), "small");
        Path audioDirectory = Files.createDirectory(temporary.resolve("audio"));
        Path audio = Files.writeString(audioDirectory.resolve("audio.mp3"), "voice");
        List<String> order = new ArrayList<>();

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> { order.add("duration"); return 3210; },
                path -> { order.add("compress"); return compressed; },
                (path, mime, actor) -> {
                    order.add("observe");
                    assertThat(path).isEqualTo(compressed);
                    assertThat(actor.durationMs()).isEqualTo(3210);
                    return new ObservationPack(List.of(), List.of());
                },
                extractor(() -> { order.add("extract"); return audio; }),
                (path, prompt) -> { order.add("transcribe"); return "하나. 둘!"; },
                new RecordingFailureReporter());

        AnalysisResult result = analyzer.analyze(video, context("분석", null));

        assertThat(order).containsExactly(
                "duration", "compress", "observe", "extract", "transcribe");
        assertThat(result.wasCompressed()).isTrue();
        assertThat(result.transcripts()).containsExactly("하나.", "둘!");
        assertThat(compressed).doesNotExist();
        assertThat(audioDirectory).doesNotExist();
    }

    /**
     * 받아쓰기는 갈래로 갈리지 않는다 — 표현·그 외로 시작한 연습의 코치도 대사를 인용해
     * 말해야 한다. 예전에는 "분석" 밖에서 받아쓰기를 건너뛰었다.
     */
    @ParameterizedTest
    @ValueSource(strings = {"표현", "그 외"})
    void transcribesRegardlessOfBlockageKind(String blockageKind) throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path audioDirectory = Files.createDirectory(temporary.resolve("audio"));
        Path audio = Files.writeString(audioDirectory.resolve("audio.mp3"), "voice");
        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack(List.of(), List.of()),
                extractor(() -> audio),
                (path, prompt) -> "가지 마. 제발!",
                new RecordingFailureReporter());

        AnalysisResult result = analyzer.analyze(video, context(blockageKind, 1000));

        assertThat(result.transcripts()).containsExactly("가지 마.", "제발!");
        assertThat(audioDirectory).doesNotExist();
    }

    @Test
    void swallowsEveryTranscriptionFailureAndKeepsObservationResult() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path audioDirectory = Files.createDirectory(temporary.resolve("broken-audio"));
        Path audio = Files.writeString(audioDirectory.resolve("audio.mp3"), "voice");
        IllegalStateException failure = new IllegalStateException("transcription down");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack(List.of(), List.of("불확실")),
                extractor(() -> audio),
                (path, prompt) -> { throw failure; },
                reporter);

        AnalysisResult result = analyzer.analyze(video, context("분석", 1000));

        assertThat(result.observationPack().uncertainties()).containsExactly("불확실");
        assertThat(result.transcripts()).isEmpty();
        assertThat(audioDirectory).doesNotExist();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context()).isEqualTo("SummaryAnalyzer.transcription");
        });
    }

    /**
     * ffmpeg 구현과 같은 계약의 시험용 추출기 — 낸 것을 돌려받으면 그것이 사는 임시 디렉토리를
     * 통째로 거둔다. 위 단언들이 {@code audioDirectory} 의 소멸로 정리 여부를 판정하므로,
     * 여기서 그 계약을 흉내 내지 않으면 그 단언이 뜻을 잃는다.
     */
    private static AudioExtractor extractor(Supplier<Path> audio) {
        return new AudioExtractor() {

            @Override
            public Path extract(Path videoPath, long maximumDurationMs) {
                return audio.get();
            }

            @Override
            public void discard(Path audioPath) {
                deleteTree(audioPath.getParent());
            }
        };
    }

    private static void deleteTree(Path directory) {
        try (var paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 정리 실패는 이 테스트의 관심사가 아니다.
                }
            });
        } catch (IOException ignored) {
            // 같은 이유.
        }
    }

    private static AnalysisContext context(String blockageKind, Integer durationMs) {
        return new AnalysisContext(
                null, null, "users/u/uploads/take.mp4", "video/mp4", "etag",
                durationMs, "상황", "인물", "목표", blockageKind, "세부");
    }
}
