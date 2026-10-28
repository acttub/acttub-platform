package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.OffsetDateTime;
import com.fasterxml.jackson.annotation.JsonProperty;

final class VoiceDtos {
    private VoiceDtos() {}
    record SynthesizeRequest(String text, String voice, @JsonProperty("session_id") String sessionId) {}
    record StatusResponse(boolean available, @JsonProperty("free_until") OffsetDateTime freeUntil,
            String consent, @JsonProperty("daily_limit") int dailyLimit, @JsonProperty("daily_used") int dailyUsed,
            String reason, @JsonProperty("pro_only") boolean proOnly) {}
    record SynthesizeResponse(@JsonProperty("audio_url") String audioUrl, boolean cached,
            @JsonProperty("expires_in") int expiresIn) {}
}
