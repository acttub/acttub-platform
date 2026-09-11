package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.util.UUID;

/** {@code practiceSessionId} 를 받는 이유는 {@link ObservationAnalyzer} 와 같다. */
@FunctionalInterface
public interface SpeechAnalyzer {
    SpeechAnalysis analyze(Path videoPath, UUID practiceSessionId);
}
