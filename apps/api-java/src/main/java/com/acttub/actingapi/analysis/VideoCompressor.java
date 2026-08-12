package com.acttub.actingapi.analysis;

import java.nio.file.Path;

@FunctionalInterface
public interface VideoCompressor {
    Path compress(Path videoPath);
}
