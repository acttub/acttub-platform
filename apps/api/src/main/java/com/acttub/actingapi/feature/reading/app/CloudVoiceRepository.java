package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;

public interface CloudVoiceRepository {
    record CacheEntry(String hash, String objectKey) {}
    String consent(UUID userId);
    int dailyUsage(UUID userId, LocalDate day);
    int monthlyUsage(YearMonth month);
    CacheEntry findCache(String hash);
    void recordSuccess(UUID userId, LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now);
}
