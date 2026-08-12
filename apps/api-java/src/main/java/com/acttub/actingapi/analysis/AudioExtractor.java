package com.acttub.actingapi.analysis;

import java.nio.file.Path;

@FunctionalInterface
public interface AudioExtractor {
    Path extract(Path videoPath, long maximumDurationMs);
}
