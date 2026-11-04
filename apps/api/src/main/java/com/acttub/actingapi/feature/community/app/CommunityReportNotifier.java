package com.acttub.actingapi.feature.community.app;

import java.util.UUID;

/**
 * 커뮤니티 글·댓글의 새 신고를 팀에 알린다(SOMA-1042, Slack #문의-신고). 알림이 실패해도 신고는 그대로다 — 구현은 예외를
 * 밖으로 던지지 않는다. 신고자는 넘기지 않는다.
 */
public interface CommunityReportNotifier {

    record Notice(String targetType, UUID targetId, String reason, String detail) {
    }

    void filed(Notice notice);

    CommunityReportNotifier NONE = notice -> { };
}
