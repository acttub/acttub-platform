package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 신고 처리 상태. */
public enum EntryReportStatus implements PgEnum {
    RECEIVED("received"), REVIEWED("reviewed");
    private final String value;
    EntryReportStatus(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryReportStatus> {
        public JpaConverter() { super(EntryReportStatus.class); }
    }
}
