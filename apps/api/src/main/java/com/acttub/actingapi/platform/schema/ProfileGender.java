package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code user_profiles.gender} 의 값 (account.profile).
 *
 * <p>{@code unspecified}("선택 안 함")도 하나의 값이라 필수를 만족한다. 포트폴리오 공개 페이지에 낼
 * 때만 칸을 뺀다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ProfileGender implements PgEnum {
    FEMALE("female"),
    MALE("male"),
    UNSPECIFIED("unspecified");

    private final String dbValue;

    ProfileGender(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ProfileGender> {
        public JpaConverter() {
            super(ProfileGender.class);
        }
    }
}
