package com.acttub.actingapi.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface AnalysisProcessor {
    AnalysisResult analyze(Path videoPath, AnalysisContext context);
}
