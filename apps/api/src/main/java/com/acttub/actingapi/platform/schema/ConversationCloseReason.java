package com.acttub.actingapi.platform.schema;

/**
 * {@code coach_conversations.close_reason} 의 값 — 코치 대화가 닫힌 사유 (practice.coach).
 *
 * <p>옛 {@link CloseReason} 의 셋(exhausted·limit·user_ended)에 신형의 {@code system_failure} 가 더해진다(practice.note). 옛
 * {@code gap_stated} 는 지금 코드가 만들지 않아 뺐다 — 옛 대화를 옮길 때 exhausted 로 바꾼다(SOMA-1130).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ConversationCloseReason implements PgEnum {
    /** 더 물을 것이 없다. */
    EXHAUSTED("exhausted"),
    /** 코치 응답 수 상한에 닿았다. 상한 숫자는 practice.coach 와 {@code ConversationService} 가 정본이다. */
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
}
