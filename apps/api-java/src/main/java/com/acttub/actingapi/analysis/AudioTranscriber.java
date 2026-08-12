package com.acttub.actingapi.analysis;

import java.nio.file.Path;

@FunctionalInterface
public interface AudioTranscriber {
    String transcribe(Path audioPath, String prompt);
}
