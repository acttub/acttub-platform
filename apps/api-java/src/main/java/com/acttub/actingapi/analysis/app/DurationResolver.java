package com.acttub.actingapi.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface DurationResolver {
    int durationMs(Path videoPath, Integer declaredDurationMs);
}
