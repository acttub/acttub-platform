package com.acttub.actingapi.platform.schema;

import java.util.HashMap;
import java.util.Map;

import jakarta.persistence.AttributeConverter;

/**
 * {@link PgEnum} 공통 컨버터 뼈대. 서브클래스는 {@code @Converter} 를 붙이고 enum 클래스만 넘긴다.
 *
 * <p><b>{@code convertToEntityAttribute} 의 예외가 값 무결성의 두 번째 그물이다.</b> 첫 번째는
 * DB 의 CHECK 제약이고, 그것을 우회해 들어온 값(수동 SQL 등)은 여기서 읽힐 때 터진다.
 * 컬럼이 네이티브 enum 이던 시절에는 타입 자체가 그 일을 했다 (SOMA-462, CONTRACT.md §5-3-1).
 */
public abstract class PgEnumConverter<E extends Enum<E> & PgEnum>
        implements AttributeConverter<E, String> {

    private final Map<String, E> byDbValue = new HashMap<>();

    protected PgEnumConverter(Class<E> type) {
        for (E constant : type.getEnumConstants()) {
            byDbValue.put(constant.dbValue(), constant);
        }
    }

    @Override
    public String convertToDatabaseColumn(E attribute) {
        return attribute == null ? null : attribute.dbValue();
    }

    @Override
    public E convertToEntityAttribute(String dbData) {
        if (dbData == null) {
            return null;
        }
        E value = byDbValue.get(dbData);
        if (value == null) {
            throw new IllegalArgumentException("unknown enum value from database: " + dbData);
        }
        return value;
    }
}
