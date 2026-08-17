package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface VideoCompressor {
    Path compress(Path videoPath);
}
