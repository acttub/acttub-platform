package com.acttub.actingapi.analysis;

import java.nio.file.Path;

@FunctionalInterface
public interface AnalysisProcessor {
    AnalysisResult analyze(Path videoPath, AnalysisContext context);
}
