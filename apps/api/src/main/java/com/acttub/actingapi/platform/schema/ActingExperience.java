package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code user_profiles.experience} 의 값 — 연기 경력 구간 (account.profile).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ActingExperience implements PgEnum {
    BEFORE_START("before_start"),
    EXAM_PREP("exam_prep"),
    UNDER_1Y("under_1y"),
    Y1_TO_3("y1_to_3"),
    Y3_TO_5("y3_to_5"),
    OVER_5Y("over_5y");

    private final String dbValue;

    ActingExperience(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ActingExperience> {
        public JpaConverter() {
            super(ActingExperience.class);
        }
    }
}
