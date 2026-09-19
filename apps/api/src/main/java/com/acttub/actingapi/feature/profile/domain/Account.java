package com.acttub.actingapi.feature.profile.domain;

import java.util.UUID;

/**
 * 사용자가 자기 자신으로 보는 것 — 계정 뼈대와 프로필. CONTEXT.md 가 말하는 Domain Model 이다.
 *
 * <p>{@code status} 를 {@code UserStatus} 가 아니라 문자열로 들고 있는다 — 그 열거형은
 * {@code jakarta.persistence.Converter} 를 끌고 있고, 이 값은 그대로 응답에 실려 나가므로
 * 열거형으로 바꾸면 이름을 다시 문자열로 되돌리는 지점이 생긴다. 그 자리가 계약이 어긋나는
 * 자리다({@code practice} 와 같은 판단).
 *
 * @param accountType {@code member} 또는 {@code guest}. 신원이 {@code guest} 뿐이면 게스트다 —
 *        {@code users} 에 컬럼을 늘리지 않는다
 * @param profile 프로필 행이 없으면 {@code null}. 게스트와, 아직 한 번도 저장하지 않은 회원이 그렇다
 */
public record Account(UUID id, String email, String status, String accountType, Profile profile) {

    public boolean profileComplete() {
        return profile != null && profile.complete();
    }
}
