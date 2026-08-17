package com.acttub.actingapi.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface VideoCompressor {
    Path compress(Path videoPath);
}
