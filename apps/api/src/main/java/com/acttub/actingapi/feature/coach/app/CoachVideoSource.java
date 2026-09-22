package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/** Original media belonging to the visible, owned practice session. */
public interface CoachVideoSource {
    record Video(String objectKey, String mimeType, String etag) { }
    Video find(UUID userId, UUID practiceSessionId);
}
