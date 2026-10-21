package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code script_characters} — 대본 안에서 대사를 말하는 인물 하나 (reading.script · reading.cast).
 *
 * <p>줄은 이름이 아니라 이 id 로 배역에 매달리므로 이름을 고쳐도 연결은 그대로다. {@code voice_preset} 은
 * 상대역 목소리(기기 프리셋 id)이고 NULL 이면 "자동"이다. {@code gender}·{@code age_band}(V42, SOMA-670)는 나누기 모델이
 * 대본에서 읽은 값이고 모르면 NULL 이다 — 자동 목소리가 이것으로 프리셋을 고른다. {@code member_ids}(V50, SOMA-709)는 함께 말하는 줄의
 * 묶음 배역이면 그 줄을 함께 말하는 배역들의 id 이고 보통 배역이면 NULL 이다.
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

    @Column(name = "gender")
    @Convert(converter = CharacterGender.JpaConverter.class)
    private CharacterGender gender;

    @Column(name = "age_band")
    @Convert(converter = CharacterAgeBand.JpaConverter.class)
    private CharacterAgeBand ageBand;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "member_ids", columnDefinition = "uuid[]")
    private UUID[] memberIds;

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

    public ScriptCharacterEntity(UUID id, UUID scriptId, String name, int sortOrder, String voicePreset,
            CharacterGender gender, CharacterAgeBand ageBand) {
        this(id, scriptId, name, sortOrder, voicePreset);
        this.gender = gender;
        this.ageBand = ageBand;
    }

    /** @param memberIds 묶음 배역이면 함께 말하는 배역들의 id, 보통 배역이면 {@code null} */
    public ScriptCharacterEntity(UUID id, UUID scriptId, String name, int sortOrder, String voicePreset,
            CharacterGender gender, CharacterAgeBand ageBand, UUID[] memberIds) {
        this(id, scriptId, name, sortOrder, voicePreset, gender, ageBand);
        this.memberIds = memberIds;
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

    public CharacterGender getGender() {
        return gender;
    }

    public CharacterAgeBand getAgeBand() {
        return ageBand;
    }

    public UUID[] getMemberIds() {
        return memberIds;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
