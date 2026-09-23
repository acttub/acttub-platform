package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code coach_conversations.close_reason} 의 값 — 코치 대화가 닫힌 사유 (practice.coach).
 *
 * <p>옛 {@link CloseReason} 의 넷에 신형의 {@code system_failure} 가 더해진다(practice.note).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ConversationCloseReason implements PgEnum {
    /** 배우가 막힘을 말로 정리했다. */
    GAP_STATED("gap_stated"),
    /** 더 물을 것이 없다. */
    EXHAUSTED("exhausted"),
    /** 코치 응답 수 상한에 닿았다(기존 갈래 8, 신형 10). */
    LIMIT("limit"),
    /** 배우가 "그만"으로 마쳤다. */
    USER_ENDED("user_ended"),
    /** 신형: 종료 응답 생성이 거듭 실패해 확인된 것만 남기고 닫았다. */
    SYSTEM_FAILURE("system_failure");

    private final String dbValue;

    ConversationCloseReason(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ConversationCloseReason> {
        public JpaConverter() {
            super(ConversationCloseReason.class);
        }
    }
}
