package com.acttub.actingapi.feature.reading.schema;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

@Entity
@Table(name = "reading_voice_usage")
@IdClass(ReadingVoiceUsageEntity.Key.class)
class ReadingVoiceUsageEntity {
    @Id @Column(name = "user_id") UUID userId;
    @Id @Column(name = "day") LocalDate day;
    @Column(name = "lines") int lines;
    protected ReadingVoiceUsageEntity() {}
    public static final class Key implements Serializable {
        public UUID userId;
        public LocalDate day;
        public Key() {}
        public Key(UUID userId, LocalDate day) { this.userId = userId; this.day = day; }
        @Override public boolean equals(Object other) {
            return other instanceof Key key && Objects.equals(userId, key.userId) && Objects.equals(day, key.day);
        }
        @Override public int hashCode() { return Objects.hash(userId, day); }
    }
}
