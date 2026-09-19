package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code user_profiles.goal} 의 값 — 최종 목표 (account.profile).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ActingGoal implements PgEnum {
    HOBBY("hobby"),
    AUDITION("audition"),
    PROFESSIONAL("professional");

    private final String dbValue;

    ActingGoal(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ActingGoal> {
        public JpaConverter() {
            super(ActingGoal.class);
        }
    }
}
