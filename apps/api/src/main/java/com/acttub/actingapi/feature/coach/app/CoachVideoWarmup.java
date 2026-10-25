package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.DirectVideoWarmup;
import com.acttub.actingapi.feature.video.app.VideoUploadWarmup;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;

/**
 * 첫 질문용 영상을 미리 준비한다(SOMA-780).
 *
 * <p>앱은 연습을 만든 뒤 '분석 중' 화면에서 분석 작업이 끝나길 기다렸다가 첫 질문을 청한다. 지금까지는 첫 질문 요청이 와서야
 * 영상을 내려받고, 소리를 검사하고, Gemini 에 올리고, 처리가 끝나길 기다렸다(10/20 운영 서버 실측: 78초 영상 올리기 4.2초 +
 * 처리 4.8초, 125초 영상 3.6초 + 5.6초). 분석 작업이 원본을 내려받은 그 자리에서 같은 일을 뒤에서 시작해 두면, 첫 질문은
 * 남은 만큼만 기다린다. 소리 검사·올리기 방식은 첫 질문이 직접 할 때와 똑같다 — 코치가 받는 입력은 바뀌지 않는다.
 *
 * <p>코칭을 시작하지 않고 나간 회차의 영상은 {@link CoachVideoCache} 가 idle 이 지나면 지운다.
 *
 * <p>10/21: 분석 작업보다 앞서, 영상 올리기가 끝난 순간에도 시작한다({@link #uploaded}). 운영에서 앱은 연습을 만든 뒤 약 5초
 * 만에 첫 질문을 청하는데, 준비는 8~12초가 걸려 첫 질문이 남은 만큼 기다렸다. 올리기 끝에서 시작하면 배우가 '질문 받기'를
 * 누르기까지의 시간도 겨친다. 이때는 분석 작업이 다시 올리지 않는다.
 */
public final class CoachVideoWarmup implements DirectVideoWarmup, VideoUploadWarmup {
    /** 처리 대기 한도. 첫 질문이 직접 올릴 때와 같다. */
    static final Duration PROCESSING = Duration.ofSeconds(180);
    private final DirectVideoModel model;
    private final CoachVideoCache cache;
    private final Duration processingWait;
    /** 올리기 끝 준비가 원본을 내려받는 곳. 없으면 올리기 끝 준비를 하지 않는다(분석 작업만). */
    private final ObjectStorage storage;
    private final Path workDir;
    /** 코칭 1층 관찰(SOMA-815). 분석 작업이 원본을 넘길 때 배정된 연습이면 함께 시작한다. */
    private CoachLayerOne layerOne = CoachLayerOne.NONE;

    public CoachVideoWarmup(DirectVideoModel model, CoachVideoCache cache) {
        this(model, cache, null, null, PROCESSING);
    }

    /**
     * @param storage 있으면 영상 올리기가 끝날 때도 준비를 시작한다
     * @param workDir 올리기 끝 준비가 원본을 잠깐 내려받는 폴더
     */
    public CoachVideoWarmup(DirectVideoModel model, CoachVideoCache cache, ObjectStorage storage, Path workDir) {
        this(model, cache, storage, workDir, PROCESSING);
    }

    /** Test-only: 처리 대기 한도를 줄여 본다. */
    CoachVideoWarmup(DirectVideoModel model, CoachVideoCache cache, Duration processingWait) {
        this(model, cache, null, null, processingWait);
    }

    CoachVideoWarmup(DirectVideoModel model, CoachVideoCache cache, ObjectStorage storage, Path workDir,
            Duration processingWait) {
        this.model = model;
        this.cache = cache == null ? CoachVideoCache.NONE : cache;
        this.processingWait = processingWait;
        this.storage = workDir == null ? null : storage;
        this.workDir = workDir;
    }

    /**
     * 영상 올리기가 끝났다: 원본을 내려받아 소리 검사·올리기·처리 대기를 뒤에서 한다. 내려받기도 뒤에서 한다 —
     * 올리기 완료 응답을 늦추지 않는다. 같은 원본을 이미 준비하고 있으면 아무것도 하지 않는다.
     */
    /** 코칭 1층 관찰을 함께 시작한다(SOMA-815). null 이면 끔. */
    public CoachVideoWarmup withLayerOne(CoachLayerOne layerOne) {
        this.layerOne = layerOne == null ? CoachLayerOne.NONE : layerOne;
        return this;
    }

    @Override
    public void uploaded(String objectKey, String etag, String contentType) {
        if (model == null || storage == null || !cache.enabled() || objectKey == null || objectKey.isBlank()) return;
        String mimeType = contentType == null || contentType.isBlank() ? "video/mp4" : contentType;
        String label = cache.sourceLabel(objectKey, etag);
        cache.warmSource(objectKey, etag, () -> prepare(download(objectKey, etag), mimeType, label));
    }

    /** 원본을 내려받는다. 올린 뒤 바뀌었으면(etag 가 다르면) 준비하지 않는다 — 첫 질문이 직접 한다. */
    private Path download(String objectKey, String etag) {
        Path local;
        try {
            local = Files.createTempFile(workDir, "coach-upload-", ".video");
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        try {
            StoredObjectMetadata metadata = storage.downloadToPath(objectKey, local);
            if (etag != null && !etag.isBlank() && metadata != null && metadata.etag() != null
                    && !etag.replace("\"", "").equals(metadata.etag().replace("\"", ""))) {
                throw new IllegalStateException("original video changed after upload");
            }
            return local;
        } catch (RuntimeException failure) {
            deleteQuietly(local);
            throw failure;
        }
    }

    @Override
    public void warm(AnalysisContext context, Path file) {
        if (context != null && file != null) {
            try {
                layerOne.start(context.sessionId(), context.userId(), file, context.mimeType(),
                        new CoachLayerOne.Scene(context.situation(), context.characterContext(), context.goal()));
            } catch (RuntimeException ignored) {
                // 1층은 덤이다. 실패해도 코칭은 지금처럼 간다.
            }
        }
        if (model == null || !cache.enabled() || context == null || file == null) return;
        if (context.sessionId() == null || context.objectKey() == null) return;
        if (context.faceMosaic()) {
            // 얼굴 가리기: 분석 작업이 넘긴 파일은 얼굴을 가린 사본이다. 올리기 끝에서 원본으로 시작한 준비는 버리고(올린 원본은
            // 지운다) 사본으로 다시 준비한다. 키를 따로 써서 첫 질문이 원본 준비를 가져가지 않는다.
            cache.discardSource(context.objectKey(), context.etag());
            var masked = new CoachVideoCache.Key(context.sessionId(),
                    CoachVideoCache.faceMosaicSource(context.objectKey()), context.etag());
            warmCopy(masked, file, "video/mp4");
            return;
        }
        var key = new CoachVideoCache.Key(context.sessionId(), context.objectKey(), context.etag());
        // 올리기가 끝났을 때 이미 같은 원본을 준비하고 있다 — 첫 질문이 그것을 가져간다.
        if (cache.warmingSource(key)) return;
        String mimeType = context.mimeType() == null || context.mimeType().isBlank() ? "video/mp4" : context.mimeType();
        warmCopy(key, file, mimeType);
    }

    private void warmCopy(CoachVideoCache.Key key, Path file, String mimeType) {
        String label = cache.label(key);
        // 분석 작업은 이 호출이 끝나면 원본 임시 파일을 지운다 — 뒤에서 쓸 사본을 지금 만든다.
        Path made = null;
        try {
            // 분석 작업의 임시 파일과 같은 폴더에 둔다.
            made = Files.createTempFile(file.toAbsolutePath().getParent(), "coach-warm-", ".video");
            Files.copy(file, made, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            if (made != null) deleteQuietly(made);
            throw new UncheckedIOException(failure);
        }
        Path copy = made;
        if (!cache.warm(key, () -> prepare(copy, mimeType, label))) deleteQuietly(copy);
    }

    private CoachVideoCache.Prepared prepare(Path copy, String mimeType, String label) {
        DirectVideoModel.Video uploaded = null;
        try {
            DirectVideoModel.InputInspection inspection = model.inspect(copy);
            // 소리가 없거나 빈 영상이면 올리지 않는다. 첫 질문이 이 검사 결과로 바로 안내한다.
            if (inspection != null && (inspection.unusableAudio() || inspection.emptyInput())) {
                return new CoachVideoCache.Prepared(inspection, null);
            }
            uploaded = label != null ? model.upload(copy, mimeType, inspection, label)
                    : inspection == null || inspection.hasAudioTrack() == null
                    ? model.upload(copy, mimeType) : model.upload(copy, mimeType, inspection);
            long deadline = System.nanoTime() + processingWait.toNanos();
            while (!model.ready(uploaded)) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                Thread.sleep(500);
            }
            return new CoachVideoCache.Prepared(inspection, uploaded);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            deleteUploaded(uploaded);
            return null;
        } catch (RuntimeException failure) {
            deleteUploaded(uploaded);
            throw failure;
        } finally {
            deleteQuietly(copy);
        }
    }

    private void deleteUploaded(DirectVideoModel.Video uploaded) {
        if (uploaded == null) return;
        try {
            model.delete(uploaded);
        } catch (RuntimeException ignored) {
            // 못 지운 파일은 Gemini 가 48시간 뒤 지우고, 이름표가 있으면 고아 청소가 먼저 지운다.
        }
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 임시 파일 정리 실패는 코칭에 영향이 없다.
        }
    }
}
