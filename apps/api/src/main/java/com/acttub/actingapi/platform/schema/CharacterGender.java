package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code script_characters.gender} 의 값 — 나누기 모델이 대본에서 읽은 배역의 성별 (reading.cast, SOMA-670). 모르면 NULL 이다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이고 모델이 답하는 글자이기도 하다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum CharacterGender implements PgEnum {
    MALE("m"),
    FEMALE("f");

    private final String dbValue;

    CharacterGender(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    /** 저장값·모델 답(대소문자·앞뒤 공백 무시)에서. 목록 밖이면 {@code null}. */
    public static CharacterGender of(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.strip().toLowerCase(java.util.Locale.ROOT);
        for (CharacterGender gender : values()) {
            if (gender.dbValue.equals(normalized)) {
                return gender;
            }
        }
        return null;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<CharacterGender> {
        public JpaConverter() {
            super(CharacterGender.class);
        }
    }
}
