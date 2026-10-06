package com.acttub.actingapi.feature.push.adapter.web;

import com.acttub.actingapi.feature.push.app.AppVersion;

final class ClientAppVersion {
    private ClientAppVersion() {}

    static String parse(String client) {
        if (client == null || !client.startsWith("app/") || client.length() == 4) return null;
        String version = client.substring(4);
        return AppVersion.valid(version) ? version : null;
    }
}
