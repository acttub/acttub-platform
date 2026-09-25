package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

public enum ChallengeOrigin implements PgEnum {
    TEAM("team"), MEMBER("member");
    private final String value;
    ChallengeOrigin(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ChallengeOrigin> {
        public JpaConverter() { super(ChallengeOrigin.class); }
    }
}
