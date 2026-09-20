package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code script_lines.kind} 의 값 — 줄의 종류 (reading.script).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ScriptLineKind implements PgEnum {
    /** 대사 — 배역 하나에 매달린다. */
    DIALOGUE("dialogue"),
    /** 지문 — 행동·상황 설명, 배역이 없다. */
    DIRECTION("direction"),
    /** 장면 — 막·장 머리 줄, 배역이 없다. */
    SCENE("scene");

    private final String dbValue;

    ScriptLineKind(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ScriptLineKind> {
        public JpaConverter() {
            super(ScriptLineKind.class);
        }
    }
}
