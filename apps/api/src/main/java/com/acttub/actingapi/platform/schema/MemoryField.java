package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code actor_memories.field} 의 값 — 배우 기억의 네 항목 (practice.memory).
 *
 * <p>성별·나이는 여기 없다 — 프로필로 옮겼다(account.profile). 옛 {@link ActorMemoryField} 는 그 둘을 포함한
 * 여섯이고 옛 테이블이 계속 쓴다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum MemoryField implements PgEnum {
    /** 연기로 이루려는 것. */
    GOAL("goal"),
    /** 자주 막히는 지점. */
    BLOCKAGE("blockage"),
    /** 배우가 말하는 자기 화술. */
    SPEECH_SELF("speech_self"),
    /** 영상에서 관찰된 화술. */
    SPEECH_ACTUAL("speech_actual");

    private final String dbValue;

    MemoryField(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<MemoryField> {
        public JpaConverter() {
            super(MemoryField.class);
        }
    }
}
