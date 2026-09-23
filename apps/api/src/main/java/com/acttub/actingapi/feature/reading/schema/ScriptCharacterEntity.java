package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code script_characters} — 대본 안에서 대사를 말하는 인물 하나 (reading.script · reading.cast).
 *
 * <p>줄은 이름이 아니라 이 id 로 배역에 매달리므로 이름을 고쳐도 연결은 그대로다. {@code voice_preset} 은
 * 상대역 목소리(기기 프리셋 id)이고 NULL 이면 "자동"이다.
 */
@Entity
@Table(name = "script_characters")
public class ScriptCharacterEntity extends AppGeneratedUuidEntity {

    @Column(name = "script_id", nullable = false)
    private UUID scriptId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "voice_preset")
    private String voicePreset;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ScriptCharacterEntity() {
    }

    public ScriptCharacterEntity(UUID id, UUID scriptId, String name, int sortOrder, String voicePreset) {
        super(id);
        this.scriptId = scriptId;
        this.name = name;
        this.sortOrder = sortOrder;
        this.voicePreset = voicePreset;
    }

    public UUID getScriptId() {
        return scriptId;
    }

    public String getName() {
        return name;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public String getVoicePreset() {
        return voicePreset;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
