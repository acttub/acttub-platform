package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code script_lines} — 대본을 순서대로 나눈 한 줄 (reading.script).
 *
 * <p>대사만 {@code character_id} 를 갖고 지문·장면은 NULL 이다. 저장 뒤 줄 구조는 고정이라 녹음·암기 상태가
 * 이 id 를 가리킨다. "대사 번호"는 저장하지 않고 {@code ordinal} 순서에서 센다.
 */
@Entity
@Table(name = "script_lines")
public class ScriptLineEntity extends AppGeneratedUuidEntity {

    @Column(name = "script_id", nullable = false)
    private UUID scriptId;

    @Column(name = "ordinal", nullable = false)
    private int ordinal;

    @Convert(converter = ScriptLineKind.JpaConverter.class)
    @Column(name = "kind", nullable = false, columnDefinition = "text")
    private ScriptLineKind kind;

    @Column(name = "character_id")
    private UUID characterId;

    @Column(name = "text", nullable = false)
    private String text;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected ScriptLineEntity() {
    }

    public ScriptLineEntity(UUID id, UUID scriptId, int ordinal, ScriptLineKind kind, UUID characterId, String text) {
        super(id);
        this.scriptId = scriptId;
        this.ordinal = ordinal;
        this.kind = kind;
        this.characterId = characterId;
        this.text = text;
    }

    public UUID getScriptId() {
        return scriptId;
    }

    public int getOrdinal() {
        return ordinal;
    }

    public ScriptLineKind getKind() {
        return kind;
    }

    public UUID getCharacterId() {
        return characterId;
    }

    public String getText() {
        return text;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
