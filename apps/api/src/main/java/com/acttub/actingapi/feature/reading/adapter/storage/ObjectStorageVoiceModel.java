package com.acttub.actingapi.feature.reading.adapter.storage;

import java.util.Optional;

import com.acttub.actingapi.feature.reading.app.VoiceModelStorage;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.stereotype.Component;

@Component
class ObjectStorageVoiceModel implements VoiceModelStorage {
    private final Optional<ObjectStorage> storage;
    ObjectStorageVoiceModel(Optional<ObjectStorage> storage) { this.storage = storage; }
    public boolean configured() { return storage.isPresent(); }
    public String downloadUrl(String key, int expiresInSeconds) {
        return storage.orElseThrow(() -> new NoCredentialsError("storage is not configured")).presignPlayback(key, expiresInSeconds);
    }
}
