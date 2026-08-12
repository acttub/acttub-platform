package com.acttub.actingapi.summary;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** DB 없이 acting-summary 층을 사용하는 테스트용 원본 동형 저장소. */
public final class InMemorySummaryStore implements SummaryStore {

    private final Map<String, SummaryRecord> records = new LinkedHashMap<>();

    @Override
    public String createSummary(
            String userId,
            ActorMaterial actor,
            ObservationPack observationPack,
            String videoFilename,
            long videoSizeBytes,
            boolean wasCompressed,
            String model) {
        String summaryId = UUID.randomUUID().toString();
        records.put(summaryId, new SummaryRecord(
                userId,
                actor,
                observationPack,
                videoFilename,
                videoSizeBytes,
                wasCompressed,
                model));
        return summaryId;
    }

    public Map<String, SummaryRecord> records() {
        return records;
    }

    public record SummaryRecord(
            String userId,
            ActorMaterial actor,
            ObservationPack observationPack,
            String videoFilename,
            long videoSizeBytes,
            boolean wasCompressed,
            String model) {
    }
}
