package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 알림 한 행의 푸시 처리 상태. 토글 끔·토큰 없음·볼 수 없게 된 사건은 skipped 다. */
public enum NotificationPushStatus implements PgEnum {
    PENDING("pending"), ATTEMPTED("attempted"), SKIPPED("skipped");
    private final String value;
    NotificationPushStatus(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NotificationPushStatus> {
        public JpaConverter() { super(NotificationPushStatus.class); }
    }
}
