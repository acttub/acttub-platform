package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code users.status} 의 값 — 계정 생명주기 축이다.
 *
 * <p>{@code suspended} 는 없다. 계정을 정지시키는 경로가 코드 어디에도 없었고
 * (이 컬럼을 UPDATE 하는 곳은 탈퇴의 {@code deactivated} 하나뿐), 운영·dev 양쪽 0건을
 * 확인한 뒤 걷어냈다 (SOMA-462). 관리자 인증은 별도 운영 토큰으로 판정한다.
 */
public enum UserStatus implements PgEnum {
    ACTIVE("active"),
    DEACTIVATED("deactivated");

    private final String dbValue;

    UserStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<UserStatus> {
        public JpaConverter() {
            super(UserStatus.class);
        }
    }
}
