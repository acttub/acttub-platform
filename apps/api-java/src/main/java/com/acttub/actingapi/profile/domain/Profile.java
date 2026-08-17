package com.acttub.actingapi.profile.domain;

import java.util.UUID;

/**
 * 사용자가 자기 자신으로 보는 것. CONTEXT.md 가 말하는 Domain Model 이며 {@code users} 행에서
 * 프로필로 쓰이는 만큼만 옮겨 담는다.
 *
 * <p>{@code status} 를 {@code UserStatus} 가 아니라 문자열로 들고 있는다 — 그 열거형은
 * {@code jakarta.persistence.Converter} 를 끌고 있고, 이 값은 그대로 응답에 실려 나가므로
 * 열거형으로 바꾸면 이름을 다시 문자열로 되돌리는 지점이 생긴다. 그 자리가 계약이 어긋나는
 * 자리다({@code practice} 와 같은 판단).
 */
public record Profile(UUID id, String email, String nickname, String status) {
}
