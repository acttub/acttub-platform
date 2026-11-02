package com.acttub.actingapi.feature.push.app;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

/** 단말 하나로 보낼 알림 한 건. {@code to} 는 Expo push token 이다. */
public record PushMessage(String to, String title, String body, Map<String, String> data) {

    /** 앱이 권한을 물을 때 만드는 안드로이드 기본 채널(apps/mobile lib/notifications DEFAULT_ANDROID_CHANNEL_ID). */
    public static final String ANDROID_CHANNEL_ID = "default";

    /**
     * 안드로이드 알림 채널. 비워 두면 Expo 가 대체 채널(expo_notifications_fallback)로 보내 무음으로 떴다(11/2 폰 QA).
     */
    @JsonProperty("channelId")
    public String channelId() {
        return ANDROID_CHANNEL_ID;
    }

    /** 기기 기본 알림음. 비워 두면 무음 표시로 온다. 실제 소리·진동은 사용자의 채널·방해 금지 설정을 따른다. */
    @JsonProperty("sound")
    public String sound() {
        return "default";
    }
}
