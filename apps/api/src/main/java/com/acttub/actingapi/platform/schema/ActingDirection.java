package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code user_profile_directions.direction} 의 값 — 추구하는 방향, 복수 선택이다 (account.profile).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ActingDirection implements PgEnum {
    MEDIA("media"),
    STAGE("stage");

    private final String dbValue;

    ActingDirection(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ActingDirection> {
        public JpaConverter() {
            super(ActingDirection.class);
        }
    }
}
