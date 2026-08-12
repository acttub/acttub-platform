package com.acttub.actingapi.summary;

public interface SummaryStore {
    String createSummary(
            String userId,
            ActorMaterial actor,
            ObservationPack observationPack,
            String videoFilename,
            long videoSizeBytes,
            boolean wasCompressed,
            String model);
}
