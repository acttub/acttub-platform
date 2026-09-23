package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

public enum ChallengeRankingState implements PgEnum {
    PENDING("pending"), FINAL("final");
    private final String value;
    ChallengeRankingState(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ChallengeRankingState> {
        public JpaConverter() { super(ChallengeRankingState.class); }
    }
}
