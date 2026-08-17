package com.acttub.actingapi.platform.schema;

import java.util.HashMap;
import java.util.Map;

import jakarta.persistence.AttributeConverter;

/**
 * {@link PgEnum} 공통 컨버터 뼈대. 서브클래스는 {@code @Converter} 를 붙이고 enum 클래스만 넘긴다.
 *
 * <p>M0 은 검증에 필요한 2종만 만든다. 17종 전량은 M2 에서 채운다 (/SPEC.md §5-3-1).
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
