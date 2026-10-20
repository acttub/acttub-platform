package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.DirectVideoWarmup;
import com.acttub.actingapi.integration.observation.DirectVideoModel;

/**
 * 첫 질문용 영상을 미리 준비한다(SOMA-780).
 *
 * <p>앱은 연습을 만든 뒤 '분석 중' 화면에서 분석 작업이 끝나길 기다렸다가 첫 질문을 청한다. 지금까지는 첫 질문 요청이 와서야
 * 영상을 내려받고, 소리를 검사하고, Gemini 에 올리고, 처리가 끝나길 기다렸다(10/20 운영 서버 실측: 78초 영상 올리기 4.2초 +
 * 처리 4.8초, 125초 영상 3.6초 + 5.6초). 분석 작업이 원본을 내려받은 그 자리에서 같은 일을 뒤에서 시작해 두면, 첫 질문은
 * 남은 만큼만 기다린다. 소리 검사·올리기 방식은 첫 질문이 직접 할 때와 똑같다 — 코치가 받는 입력은 바뀌지 않는다.
 *
 * <p>코칭을 시작하지 않고 나간 회차의 영상은 {@link CoachVideoCache} 가 idle 이 지나면 지운다.
 */
public final class CoachVideoWarmup implements DirectVideoWarmup {
    /** 처리 대기 한도. 첫 질문이 직접 올릴 때와 같다. */
    static final Duration PROCESSING = Duration.ofSeconds(180);
    private final DirectVideoModel model;
    private final CoachVideoCache cache;

    public CoachVideoWarmup(DirectVideoModel model, CoachVideoCache cache) {
        this.model = model;
        this.cache = cache == null ? CoachVideoCache.NONE : cache;
    }

    @Override
    public void warm(AnalysisContext context, Path file) {
        if (model == null || !cache.enabled() || context == null || file == null) return;
        if (context.sessionId() == null || context.objectKey() == null) return;
        var key = new CoachVideoCache.Key(context.sessionId(), context.objectKey(), context.etag());
        String mimeType = context.mimeType() == null || context.mimeType().isBlank() ? "video/mp4" : context.mimeType();
        String label = cache.label(key);
        // 분석 작업은 이 호출이 끝나면 원본 임시 파일을 지운다 — 뒤에서 쓸 사본을 지금 만든다.
        Path copy;
        try {
            copy = Files.createTempFile("coach-warm-", ".video");
            Files.copy(file, copy, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
        boolean started = cache.warm(key, () -> prepare(copy, mimeType, label));
        if (!started) deleteQuietly(copy);
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
            long deadline = System.nanoTime() + PROCESSING.toNanos();
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
