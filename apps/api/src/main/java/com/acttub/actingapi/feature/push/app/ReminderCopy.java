package com.acttub.actingapi.feature.push.app;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** 고른 알림 한 건의 내용. {@link #data()} 가 푸시에 실리는 data 다. */
public record ReminderCopy(ReminderKind kind, int skippedDays, String templateId, String title, String body,
                           UUID conversationId, UUID practiceId, UUID videoId, UUID scriptId) {

    public ReminderCopy(ReminderKind kind, int skippedDays, String templateId, String title, String body,
                        UUID conversationId, UUID practiceId) {
        this(kind, skippedDays, templateId, title, body, conversationId, practiceId, null, null);
    }

    public Map<String, String> data() {
        Map<String, String> data = new LinkedHashMap<>();
        // 앱(_layout.tsx)은 kind=evening_reminder 일 때 홈으로 보낸다. 앱 빌드 없이 그 동작을 지키려고 kind 는 그대로 두고
        // 실제 종류는 reminder_kind 에 싣는다(측정용).
        data.put("kind", "evening_reminder");
        data.put("reminder_kind", kind.wire());
        data.put("skipped_days", Integer.toString(skippedDays));
        data.put("template_id", templateId);
        if (conversationId != null) data.put("conversation_id", conversationId.toString());
        if (practiceId != null) data.put("practice_id", practiceId.toString());
        if (videoId != null) data.put("video_id", videoId.toString());
        if (scriptId != null) data.put("script_id", scriptId.toString());
        return data;
    }

    /** 비교군(SOMA-870)에게는 보내지 않고 이 문구를 보냈을 자리만 남긴다. 기록의 template_id 앞에 이 표시가 붙는다. */
    public static final String HOLDOUT_PREFIX = "holdout:";

    public ReminderCopy asHoldout() {
        return new ReminderCopy(kind, skippedDays, HOLDOUT_PREFIX + templateId, title, body, conversationId, practiceId, videoId, scriptId);
    }

    public PushMessage messageTo(String token) { return new PushMessage(token, title, body, data()); }
}
