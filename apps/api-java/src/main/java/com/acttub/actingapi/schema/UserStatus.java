package com.acttub.actingapi.schema;

import jakarta.persistence.Converter;

/** {@code user_status_t} — {@code models.py} 의 {@code UserStatus}. */
public enum UserStatus implements PgEnum {
    ACTIVE("active"),
    SUSPENDED("suspended"),
    DEACTIVATED("deactivated");

    private final String dbValue;

    UserStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<UserStatus> {
        public JpaConverter() {
            super(UserStatus.class);
        }
    }
}
