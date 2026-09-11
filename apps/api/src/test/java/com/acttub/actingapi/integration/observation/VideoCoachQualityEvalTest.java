package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.adapter.media.VideoDurationProbe;
import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.SummaryAnalyzer;
import com.acttub.actingapi.feature.coach.app.CoachEngine;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.integration.media.AudioExtractor;
import com.acttub.actingapi.integration.media.GeminiVideoCompressor;
import com.acttub.actingapi.support.CoachQualityRun;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;

/** DB·로그인 없이 실제 운영 분석기→기본 코치를 잇는다. 사용자가 제공한 짧은 영상 한 건만 호출한다. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_VIDEO_EVAL", matches = "1")
class VideoCoachQualityEvalTest {
    @TempDir Path temporary;

    @Test
    void videoOnlyThroughProductionPipeline() throws Exception {
        assertThat(System.getenv("OPENAI_API_KEY")).isNotBlank();
        assertThat(System.getenv("GEMINI_API_KEY")).isNotBlank();
        assertThat(System.getenv("ACTTUB_COACH_EVAL_VIDEO")).isNotBlank();
        Path original = Path.of(System.getenv("ACTTUB_COACH_EVAL_VIDEO"));
        assertThat(original).isRegularFile().isReadable();
        // 운영 업로드 제한을 바꾸는 값이 아니라 실호출 평가의 비용·실행 시간 범위다.
        assertThat(Files.size(original)).isBetween(1L, 100_000_000L);
        String name = original.getFileName().toString().toLowerCase(Locale.ROOT);
        String extension = name.substring(name.lastIndexOf('.') + 1);
        String mimeType = switch (extension) {
            case "mp4" -> "video/mp4";
            case "mov" -> "video/quicktime";
            case "webm" -> "video/webm";
            default -> throw new IllegalArgumentException("평가 영상은 mp4, mov, webm 중 하나여야 한다");
        };
        // 분석기의 압축본·오디오 파일 생성/정리가 원본 디렉터리를 건드리지 않게 한다.
        Path video = Files.copy(original, temporary.resolve("sample." + extension));
        int durationMs = new VideoDurationProbe().durationMs(video, null);
        assertThat(durationMs).isBetween(1, 120_000);

        try (var run = new CoachQualityRun("real_video");
                var client = Client.builder().apiKey(System.getenv("GEMINI_API_KEY")).build()) {
            run.output.put("video_sha256", HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(video))));
            run.output.put("duration_ms", durationMs);
            run.output.put("review", "원본 영상과 observation_pack을 먼저 대조한다. 출처와 구간이 맞는지, "
                    + "의도·실제 경험을 확정하지 않는지 본다. 이어 대화가 같은 지점의 표현·전달을 짚으며 "
                    + "모르겠어요/길어에 맞춰 짧아지는지, 실행하지 않은 변화가 마무리에 섞이지 않는지 본다.");
            UUID practiceId = UUID.randomUUID();
            var gateway = new GoogleGenAiGateway(client);
            String model = System.getenv("GEMINI_MODEL");
            if (model == null || model.isBlank()) model = GeminiConfiguration.DEFAULT_MODEL;
            var analyzer = new SummaryAnalyzer(new VideoDurationProbe(),
                    new GeminiVideoCompressor(run.reporter)::compress,
                    new GeminiObservationAnalyzer(gateway, CoachQualityRun.MAPPER, model, run.reporter, run.telemetry),
                    new GeminiTranscriber(new AudioExtractor(), gateway, run.reporter, run.telemetry), run.reporter);
            var result = analyzer.analyze(video, new AnalysisContext(UUID.randomUUID(), practiceId,
                    "quality-eval", mimeType, null, durationMs, "", "", "", "그 외", ""));
            var pack = result.observationPack();
            run.output.set("observation_pack", CoachQualityRun.MAPPER.valueToTree(pack));
            run.output.put("was_compressed", result.wasCompressed());
            run.output.put("speech_available", pack.speech() != null);
            assertThat(pack.speech()).as("음성 분석 실패를 전체 연결 성공으로 세지 않는다").isNotNull();
            assertThat(pack.sceneSummary()).isNotBlank();
            for (var observation : pack.observations()) {
                assertThat(observation.startMs()).isGreaterThanOrEqualTo(0);
                assertThat(observation.endMs()).isBetween(observation.startMs(), (long) result.durationMs());
            }
            // 영상만 넣었으므로 배우 입력과 별도 대본은 모두 비어 있다. 받아쓰기는 pack.speech에 있다.
            var session = new CoachSessionSnapshot(UUID.randomUUID(), practiceId, UUID.randomUUID(), UUID.randomUUID(),
                    CoachQualityRun.MAPPER.valueToTree(pack), "", "", "", result.durationMs(), "그 외", "그 외", "",
                    List.of(), "", null, "open", "", List.of());
            var engine = new CoachEngine(run.generator("coach"), run.reporter, run.telemetry);
            var coaching = run.step(engine, session, null, 120);
            for (String actor : List.of("모르겠어요", "길어", "아직 해본 건 아니야. 여기까지 정리해 줘.")) {
                coaching = run.step(engine, coaching.session(), actor, 120);
            }
            assertThat(coaching.reply().status()).isEqualTo("complete");
            assertThat(coaching.reply().handoff().path("completion_level").asText()).isNotEqualTo("unavailable");
            run.passed();
        }
    }
}
