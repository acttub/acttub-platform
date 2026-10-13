package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code script_characters.age_band} 의 값 — 나누기 모델이 대본에서 읽은 배역의 나이대 (reading.cast, SOMA-670). 모르면 NULL 이다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이고 모델이 답하는 글자이기도 하다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum CharacterAgeBand implements PgEnum {
    /** 어린이. */
    CHILD("child"),
    /** 10대~20대. */
    YOUNG("young"),
    /** 30~50대. */
    ADULT("adult"),
    /** 노년. */
    SENIOR("senior");

    private final String dbValue;

    CharacterAgeBand(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    /** 저장값·모델 답(대소문자·앞뒤 공백 무시)에서. 목록 밖이면 {@code null}. */
    public static CharacterAgeBand of(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.strip().toLowerCase(java.util.Locale.ROOT);
        for (CharacterAgeBand band : values()) {
            if (band.dbValue.equals(normalized)) {
                return band;
            }
        }
        return null;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<CharacterAgeBand> {
        public JpaConverter() {
            super(CharacterAgeBand.class);
        }
    }
}
