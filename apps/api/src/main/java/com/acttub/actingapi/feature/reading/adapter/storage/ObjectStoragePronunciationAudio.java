package com.acttub.actingapi.feature.reading.adapter.storage;

import java.nio.file.Path;
import java.util.Optional;

import com.acttub.actingapi.feature.reading.app.PronunciationAudio;
import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.stereotype.Component;

/** 채점할 녹음을 오브젝트 스토리지에서 임시 파일로 받는다(SOMA-606). */
@Component
class ObjectStoragePronunciationAudio implements PronunciationAudio {
    private final Optional<ObjectStorage> configured;

    ObjectStoragePronunciationAudio(Optional<ObjectStorage> configured) {
        this.configured = configured;
    }

    @Override
    public void download(String objectKey, Path destination) {
        configured.orElseThrow(() -> new NoCredentialsError("storage is not configured")).downloadToPath(objectKey, destination);
    }
}
