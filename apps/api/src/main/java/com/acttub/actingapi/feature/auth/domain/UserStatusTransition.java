package com.acttub.actingapi.feature.auth.domain;

/**
 * 계정의 상태({@code users.status})가 넘어가는 길 전부. 정본은 docs/specs/account 의 탈퇴·게스트 이전이다.
 *
 * <p>상태를 바꾸는 UPDATE 는 {@code PostgresAccountDeactivation} 한 파일에만 있고, 그 문장이 이 표와 맞는지
 * {@code StateTransitionTest} 가 본다. 닫힌 계정을 되살리는 길은 없다.
 */
public enum UserStatusTransition {
    /** 탈퇴, 만 14세 미만 계정 닫기, 옮겨진 게스트 닫기. */
    DEACTIVATED("active", "deactivated");

    private final String from;
    private final String to;

    UserStatusTransition(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }
}
