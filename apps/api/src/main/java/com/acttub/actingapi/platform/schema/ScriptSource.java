package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code scripts.source} 의 값 — 대본을 넣은 길 (reading.script).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ScriptSource implements PgEnum {
    /** 파일에서 글자를 뽑았다. */
    FILE("file"),
    /** 붙여넣었다. 옛 앱 대본을 옮긴 것도 여기다. */
    PASTE("paste"),
    /** 직접 썼다. */
    TYPED("typed"),
    /** 내장된 예시 대본을 불러왔다. 서버는 예시를 구분하지 않는다. */
    SAMPLE("sample");

    private final String dbValue;

    ScriptSource(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ScriptSource> {
        public JpaConverter() {
            super(ScriptSource.class);
        }
    }
}
