package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 신고 사유 다섯. 화면은 각각을 선택지로 둔다. */
public enum EntryReportReason implements PgEnum {
    COPYRIGHT("copyright"), INAPPROPRIATE("inappropriate"), SPAM("spam"), DUPLICATE("duplicate"), OTHER("other");
    private final String value;
    EntryReportReason(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryReportReason> {
        public JpaConverter() { super(EntryReportReason.class); }
    }
}
