package com.acttub.actingapi.feature.push.adapter.web;

final class ClientAppVersion {
    private ClientAppVersion() {}

    static String parse(String client) {
        if (client == null || !client.startsWith("app/") || client.length() == 4) return null;
        String version = client.substring(4);
        return version.matches("[0-9]+(?:\\.[0-9]+)*") ? version : null;
    }
}
