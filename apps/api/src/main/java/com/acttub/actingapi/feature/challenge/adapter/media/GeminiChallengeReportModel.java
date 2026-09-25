package com.acttub.actingapi.feature.challenge.adapter.media;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportModel;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 챌린지 AI 리포트의 Gemini 연결 (challenge.ai-report). 내 영상과 표본 영상을 저장소에서 받아 올리고, 라벨만 붙여 한 번에
 * 보인 뒤 올린 파일과 임시 파일을 지운다. 저장소나 모델이 없으면 실패로 던져 워커가 재시도·실패를 정한다.
 */
@Component
class GeminiChallengeReportModel implements ChallengeReportModel {
    private static final Duration PROCESSING = Duration.ofSeconds(180);
    private final ObjectProvider<ObjectStorage> storage;
    private final ObjectProvider<Client> client;
    private final String modelName;
    private final FailureReporter failures;

    GeminiChallengeReportModel(ObjectProvider<ObjectStorage> storage, ObjectProvider<Client> client,
                               @Value("${GEMINI_MODEL:gemini-3-flash-preview}") String modelName, FailureReporter failures) {
        this.storage = storage; this.client = client; this.modelName = modelName; this.failures = failures;
    }

    @Override
    public Output generate(Video mine, List<Labeled> samples, String instruction) {
        ObjectStorage objects = storage.getIfAvailable();
        Client gemini = client.getIfAvailable();
        if (objects == null || gemini == null) throw new IllegalStateException("challenge report model is unavailable");
        DirectVideoModel model = new GeminiDirectVideoModel(gemini, modelName);
        var locals = new ArrayList<Path>();
        var uploaded = new ArrayList<DirectVideoModel.Video>();
        var labels = new ArrayList<String>();
        try {
            var all = new ArrayList<Labeled>();
            all.add(new Labeled("내 영상", mine));
            all.addAll(samples);
            for (Labeled item : all) {
                Path local = Files.createTempFile("challenge-report-", ".video");
                locals.add(local);
                objects.downloadToPath(item.video().objectKey(), local);
                uploaded.add(model.upload(local, item.video().contentType()));
                labels.add(item.label());
            }
            long deadline = System.nanoTime() + PROCESSING.toNanos();
            for (var video : uploaded) {
                while (!model.ready(video)) {
                    if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                    Thread.sleep(1000);
                }
            }
            return new Output(model.compare(uploaded, labels, instruction), model.model());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("challenge report interrupted", interrupted);
        } catch (java.io.IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        } finally {
            for (var video : uploaded) {
                try { model.delete(video); }
                catch (RuntimeException failure) {
                    failures.report(failure, FailureKind.EXTERNAL, new FailureContext("GeminiChallengeReportModel.delete"));
                }
            }
            for (Path local : locals) {
                try { Files.deleteIfExists(local); }
                catch (java.io.IOException failure) {
                    failures.report(failure, new FailureContext("GeminiChallengeReportModel.tempCleanup"));
                }
            }
        }
    }
}
