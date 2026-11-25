package com.acttub.actingapi.feature.challenge.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * 참여작 재생 사건 하나(조회수 1). 키는 클라이언트가 만든 사건 id 라, 같은 사건의 재전송은 한 번만 반영된다. 7일 뒤 지운다.
 * 저장소는 HQL insert·delete 로만 쓴다.
 */
@Entity
@Table(name = "entry_view_events")
public class EntryViewEventEntity {
    @Id
    @Column(name = "event_id", nullable = false)
    private UUID eventId;
    @Column(name = "entry_id", nullable = false)
    private UUID entryId;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected EntryViewEventEntity() { }

    public UUID getEventId() { return eventId; }
    public UUID getEntryId() { return entryId; }
    public UUID getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
}
