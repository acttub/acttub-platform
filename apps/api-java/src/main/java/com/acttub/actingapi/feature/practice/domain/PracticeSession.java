package com.acttub.actingapi.feature.practice.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 연습 세션 하나. CONTEXT.md 가 말하는 Domain Model 이며 {@code practice_sessions} 행을 옮겨 담는다.
 *
 * <p>{@code status} 를 열거형이 아니라 문자열로 들고 있는다. 이 값은 그대로 응답에 실려 나가고
 * 계약이 문자열이라, 열거형으로 바꾸면 이름을 다시 문자열로 되돌리는 지점이 생긴다. 그 자리가
 * 계약이 어긋나는 자리다.
 */
public record PracticeSession(
        UUID id,
        UUID userId,
        UUID uploadIntentId,
        String status,
        String situation,
        String characterContext,
        String goal,
        String blockageKind,
        String subBranch,
        String blockageDetail,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {

    /** 분석이 끝나 관찰 묶음을 함께 보여줄 상태인지. */
    public boolean analyzed() {
        return "analyzed".equals(status);
    }

    /** 분석이 실패해 오류 코드를 함께 보여줄 상태인지. */
    public boolean failed() {
        return "failed".equals(status);
    }
}
