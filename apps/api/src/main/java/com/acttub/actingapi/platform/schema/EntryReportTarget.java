package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 신고 대상 셋. */
public enum EntryReportTarget implements PgEnum {
    ENTRY("entry"), COMMENT("comment"), CHALLENGE("challenge");
    private final String value;
    EntryReportTarget(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryReportTarget> {
        public JpaConverter() { super(EntryReportTarget.class); }
    }
}
