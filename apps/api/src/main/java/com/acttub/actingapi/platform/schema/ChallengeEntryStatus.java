package com.acttub.actingapi.platform.schema;
import jakarta.persistence.Converter;
public enum ChallengeEntryStatus implements PgEnum {
    VISIBLE("visible"), HIDDEN_BY_REPORT("hidden_by_report"), DELETED("deleted");
    private final String value;
    ChallengeEntryStatus(String value) { this.value=value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply=false)
    public static class JpaConverter extends PgEnumConverter<ChallengeEntryStatus> { public JpaConverter() { super(ChallengeEntryStatus.class); } }
}
