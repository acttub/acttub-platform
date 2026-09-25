package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 묶음 푸시의 단계. 첫 사건 즉시 한 번과 구간 끝 요약 한 번이다. */
public enum NotificationPushStage implements PgEnum {
    FIRST("first"), SUMMARY("summary");
    private final String value;
    NotificationPushStage(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NotificationPushStage> {
        public JpaConverter() { super(NotificationPushStage.class); }
    }
}
