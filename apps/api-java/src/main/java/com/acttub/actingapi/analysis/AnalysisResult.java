package com.acttub.actingapi.analysis;

import java.util.List;

import com.acttub.actingapi.summary.ObservationPack;

public record AnalysisResult(
        ObservationPack observationPack,
        boolean wasCompressed,
        List<String> transcripts) {

    public AnalysisResult {
        transcripts = transcripts == null ? List.of() : List.copyOf(transcripts);
    }
}
