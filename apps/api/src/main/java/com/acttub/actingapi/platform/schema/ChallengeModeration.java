package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

public enum ChallengeModeration implements PgEnum {
    VISIBLE("visible"), REVIEW("review"), HIDDEN("hidden");
    private final String value;
    ChallengeModeration(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ChallengeModeration> {
        public JpaConverter() { super(ChallengeModeration.class); }
    }
}
