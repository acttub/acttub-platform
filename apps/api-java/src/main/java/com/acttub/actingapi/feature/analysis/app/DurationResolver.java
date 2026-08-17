package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface DurationResolver {
    int durationMs(Path videoPath, Integer declaredDurationMs);
}
