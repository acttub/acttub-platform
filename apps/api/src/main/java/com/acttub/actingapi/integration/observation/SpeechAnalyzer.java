package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;

@FunctionalInterface
public interface SpeechAnalyzer {
    SpeechAnalysis analyze(Path videoPath);
}
