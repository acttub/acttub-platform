package com.acttub.actingapi.feature.analysis.app;

import java.nio.file.Path;

@FunctionalInterface
public interface AudioTranscriber {
    String transcribe(Path audioPath, String prompt);
}
