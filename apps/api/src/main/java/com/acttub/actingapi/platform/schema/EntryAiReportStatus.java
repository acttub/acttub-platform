package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 챌린지 AI 리포트의 상태. 실행 3번을 소진하면 failed 이고 "다시 시도"는 새 생성이다. */
public enum EntryAiReportStatus implements PgEnum {
    PENDING("pending"), READY("ready"), FAILED("failed");
    private final String value;
    EntryAiReportStatus(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<EntryAiReportStatus> {
        public JpaConverter() { super(EntryAiReportStatus.class); }
    }
}
