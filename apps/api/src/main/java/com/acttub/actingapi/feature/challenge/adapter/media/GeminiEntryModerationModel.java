package com.acttub.actingapi.feature.challenge.adapter.media;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.EntryModerationModel;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.GeminiDirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.google.genai.Client;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 공개 참여작 AI 검사의 Gemini 연결 (SOMA-907). 참여작 원본(모자이크 전)을 저장소에서 받아 올리고 지시문과 함께 한 번
 * 보인 뒤, 올린 파일과 임시 파일을 지운다. 챌린지 AI 리포트와 같은 키(geminiChallengeClient)를 쓴다.
 */
@Component
class GeminiEntryModerationModel implements EntryModerationModel {
    private static final Duration PROCESSING = Duration.ofSeconds(180);
    private final ObjectProvider<ObjectStorage> storage;
    private final ObjectProvider<Client> client;
    private final String modelName;
    private final FailureReporter failures;

    GeminiEntryModerationModel(ObjectProvider<ObjectStorage> storage,
                               @Qualifier("geminiChallengeClient") ObjectProvider<Client> client,
                               @Value("${CHALLENGE_MODERATION_MODEL:${GEMINI_MODEL:gemini-3-flash-preview}}") String modelName,
                               FailureReporter failures) {
        this.storage = storage; this.client = client; this.modelName = modelName; this.failures = failures;
    }

    @Override
    public boolean available() {
        return storage.getIfAvailable() != null && client.getIfAvailable() != null;
    }

    @Override
    public Output judge(Video video, String instruction) {
        ObjectStorage objects = storage.getIfAvailable();
        Client gemini = client.getIfAvailable();
        if (objects == null || gemini == null) throw new IllegalStateException("entry moderation model is unavailable");
        DirectVideoModel model = new GeminiDirectVideoModel(gemini, modelName);
        Path local = null;
        DirectVideoModel.Video uploaded = null;
        try {
            local = Files.createTempFile("entry-moderation-", ".video");
            objects.downloadToPath(video.objectKey(), local);
            uploaded = model.upload(local, video.contentType());
            long deadline = System.nanoTime() + PROCESSING.toNanos();
            while (!model.ready(uploaded)) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                Thread.sleep(1000);
            }
            return new Output(model.compare(List.of(uploaded), List.of("참여작 영상"), instruction), model.model());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("entry moderation interrupted", interrupted);
        } catch (java.io.IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        } finally {
            if (uploaded != null) {
                try { model.delete(uploaded); }
                catch (RuntimeException failure) {
                    failures.report(failure, FailureKind.EXTERNAL, new FailureContext("GeminiEntryModerationModel.delete"));
                }
            }
            if (local != null) {
                try { Files.deleteIfExists(local); }
                catch (java.io.IOException failure) {
                    failures.report(failure, new FailureContext("GeminiEntryModerationModel.tempCleanup"));
                }
            }
        }
    }
}
