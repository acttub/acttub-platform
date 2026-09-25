package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum ChallengeEntryVisibility implements PgEnum {
    PUBLIC("public"), PRIVATE("private");
    private final String value;
    ChallengeEntryVisibility(String value) { this.value=value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply=false)
    public static class JpaConverter extends PgEnumConverter<ChallengeEntryVisibility> { public JpaConverter() { super(ChallengeEntryVisibility.class); } }
}
