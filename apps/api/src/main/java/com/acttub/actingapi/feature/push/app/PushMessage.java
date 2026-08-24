package com.acttub.actingapi.feature.push.app;

import java.util.Map;

/** 단말 하나로 보낼 알림 한 건. {@code to} 는 Expo push token 이다. */
public record PushMessage(String to, String title, String body, Map<String, String> data) {
}
