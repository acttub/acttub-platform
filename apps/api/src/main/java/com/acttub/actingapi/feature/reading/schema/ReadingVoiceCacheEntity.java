package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "reading_voice_cache")
class ReadingVoiceCacheEntity {
    @Id String hash;
    String model;
    String voice;
    @Column(name = "byte_size") int byteSize;
    @Column(name = "created_at") Instant createdAt;
    protected ReadingVoiceCacheEntity() {}
}
