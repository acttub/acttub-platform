package com.acttub.actingapi.feature.reading.app;

import java.time.OffsetDateTime;

public record CloudVoiceSettings(
        String model, String apiKey, OffsetDateTime freeUntil, int dailyLineCap, int monthlyLineCap, int proMonthlyLineCap) {
    public boolean modelConfigured() { return model != null && !model.isBlank() && apiKey != null && !apiKey.isBlank(); }
}
