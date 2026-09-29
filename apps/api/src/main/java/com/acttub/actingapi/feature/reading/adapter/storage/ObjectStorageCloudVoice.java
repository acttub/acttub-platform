package com.acttub.actingapi.feature.reading.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.reading.app.CloudVoiceStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.stereotype.Component;

@Component
class ObjectStorageCloudVoice implements CloudVoiceStorage {
    private final Optional<ObjectStorage> storage;
    ObjectStorageCloudVoice(Optional<ObjectStorage> storage) { this.storage = storage; }
    public boolean configured() { return storage.isPresent(); }
    public void upload(String key, byte[] wav) { required().upload(key, "audio/wav", wav); }
    public String playbackUrl(String key, int expiresInSeconds) { return required().presignPlayback(key, expiresInSeconds); }
    private ObjectStorage required() { return storage.orElseThrow(() -> new NoCredentialsError("storage is not configured")); }
}
