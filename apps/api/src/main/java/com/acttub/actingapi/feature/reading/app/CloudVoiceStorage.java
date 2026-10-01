package com.acttub.actingapi.feature.reading.app;

public interface CloudVoiceStorage {
    boolean configured();
    void upload(String key, byte[] wav);
    String playbackUrl(String key, int expiresInSeconds);
}
