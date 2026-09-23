package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 운영 판정. restored·dismissed 는 남은 접수가 없을 때 숨김을 푼다. */
public enum EntryReportResolution implements PgEnum {
    RESTORED("restored"), KEPT_HIDDEN("kept_hidden"), DISMISSED("dismissed");
    private final String value;
    EntryReportResolution(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryReportResolution> {
        public JpaConverter() { super(EntryReportResolution.class); }
    }
}
