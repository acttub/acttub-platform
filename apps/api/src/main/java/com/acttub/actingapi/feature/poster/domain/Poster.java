package com.acttub.actingapi.feature.poster.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 저장된 포스터. {@code revision} 을 올리면 기기에 남은 "봤음·다시 보지 않기" 가 무효가 되어 다시 보인다(app.poster).
 */
public record Poster(UUID id, int revision, PosterDraft draft, Instant createdAt, Instant updatedAt) {
}
