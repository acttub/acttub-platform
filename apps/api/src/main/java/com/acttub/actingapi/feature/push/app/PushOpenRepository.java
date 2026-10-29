package com.acttub.actingapi.feature.push.app;

import java.util.UUID;

public interface PushOpenRepository {

    /** 푸시를 눌러 앱을 연 한 번을 기록한다. 활성 계정이 아니면 조용히 지나간다. */
    void record(UUID userId, String kind, String reminderKind, String templateId, String platform, String appVersion);
}
