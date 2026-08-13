package com.acttub.actingapi.analysis;

import java.nio.file.Path;

@FunctionalInterface
public interface DurationResolver {
    int durationMs(Path videoPath, Integer declaredDurationMs);
}
