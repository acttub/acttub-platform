package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;
import java.util.List;
import com.acttub.actingapi.integration.observation.ObservationPack;

/** Completes the existing upload job without requesting layer-one AI analysis. */
public final class DirectVideoPreparation implements AnalysisProcessor {
    private final DurationResolver duration;
    private final AnalysisProcessor legacy;

    public DirectVideoPreparation(DurationResolver duration, AnalysisProcessor legacy) {
        this.duration = duration;
        this.legacy = legacy;
    }

    @Override
    public AnalysisResult analyze(Path path, AnalysisContext context) {
        if (!"three_layers_v1".equals(context.experienceVersion())) return legacy.analyze(path, context);
        return new AnalysisResult(new ObservationPack("", List.of(), List.of()), false,
                duration.durationMs(path, context.durationMs()));
    }
}
