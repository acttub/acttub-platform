package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** 챌린지 알림 사건 넷. */
public enum NotificationKind implements PgEnum {
    ENTRY_LIKED("entry_liked"), ENTRY_COMMENTED("entry_commented"), CHALLENGE_ENDED("challenge_ended"), ENTRY_AI_REPORT_READY("entry_ai_report_ready");
    private final String value;
    NotificationKind(String value) { this.value = value; }
    @Override public String dbValue() { return value; }
    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NotificationKind> {
        public JpaConverter() { super(NotificationKind.class); }
    }
}
