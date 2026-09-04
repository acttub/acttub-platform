package com.acttub.actingapi.feature.analysis.app;

import com.acttub.actingapi.integration.observation.ObservationPack;

public record AnalysisResult(ObservationPack observationPack, boolean wasCompressed) {
}
