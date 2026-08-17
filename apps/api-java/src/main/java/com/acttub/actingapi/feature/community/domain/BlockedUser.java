package com.acttub.actingapi.feature.community.domain;

import java.util.UUID;

/**
 * 차단한 상대.
 *
 * <p>닉네임이 비어 있을 수 있다. 차단 목록은 상대의 계정 상태를 가리지 않으므로 탈퇴한 사용자도
 * 그대로 남는다.
 */
public record BlockedUser(UUID id, String nickname) {
}
