package com.acttub.actingapi.feature.challenge.app;

import java.util.UUID;

/**
 * 사람이 낸 새 신고(참여작·댓글·챌린지)를 팀에 알린다(SOMA-1042, Slack #문의-신고). AI 자동 검사 신고와 재전송은 알리지
 * 않는다. 알림이 실패해도 신고는 그대로다 — 구현은 예외를 밖으로 던지지 않는다. 신고자는 넘기지 않는다.
 */
public interface ReportNotifier {

    record Notice(UUID id, String targetType, UUID targetId, String reason, String note, String targetText) {
    }

    void filed(Notice notice);

    ReportNotifier NONE = notice -> { };
}
