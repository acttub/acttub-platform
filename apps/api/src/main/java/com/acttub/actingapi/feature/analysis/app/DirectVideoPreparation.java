package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;
import java.util.List;
import com.acttub.actingapi.integration.observation.ObservationPack;

/**
 * Completes the existing upload job without requesting layer-one AI analysis.
 *
 * <p>내려받은 원본은 코치에게도 넘겨 첫 질문용 영상 준비를 미리 시작하게 한다(SOMA-780). 넘기기는 결과에 영향을 주지 않는다.
 */
public final class DirectVideoPreparation implements AnalysisProcessor {
    private final DurationResolver duration;
    private final AnalysisProcessor legacy;
    private final DirectVideoWarmup warmup;

    public DirectVideoPreparation(DurationResolver duration, AnalysisProcessor legacy) {
        this(duration, legacy, DirectVideoWarmup.NONE);
    }

    public DirectVideoPreparation(DurationResolver duration, AnalysisProcessor legacy, DirectVideoWarmup warmup) {
        this.duration = duration;
        this.legacy = legacy;
        this.warmup = warmup == null ? DirectVideoWarmup.NONE : warmup;
    }

    @Override
    public AnalysisResult analyze(Path path, AnalysisContext context) {
        if (!"three_layers_v1".equals(context.experienceVersion())) return legacy.analyze(path, context);
        try {
            warmup.warm(context, path);
        } catch (RuntimeException ignored) {
            // 미리 올리기는 덤이다. 실패해도 첫 질문이 지금처럼 직접 올린다.
        }
        return new AnalysisResult(new ObservationPack("", List.of(), List.of()), false,
                duration.durationMs(path, context.durationMs()));
    }
}
