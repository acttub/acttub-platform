package com.acttub.actingapi.feature.practice.domain;

import java.util.List;
import java.util.UUID;

/** A small view of coverage and scene content. The complete record stays inside coaching. */
public record VideoRecordSummary(UUID recordId, int recordVersion, long durationMs,
        String status, List<Range> processedRanges, List<Range> missingRanges,
        List<String> observedScene, List<String> spokenContent, List<Limit> limitations) {
    public record Range(long startMs, long endMs) { }
    public record Limit(long startMs, long endMs, String description) { }
}
