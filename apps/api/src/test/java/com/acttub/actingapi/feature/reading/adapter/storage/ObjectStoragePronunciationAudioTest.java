package com.acttub.actingapi.feature.reading.adapter.storage;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.nio.file.Path;
import java.util.Optional;

import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.junit.jupiter.api.Test;

/** 채점할 녹음 받기: 스토리지가 있으면 그대로 받고, 없으면 설정 오류로 던진다(SOMA-606). */
class ObjectStoragePronunciationAudioTest {

    @Test
    void 스토리지에서_경로로_받는다() {
        ObjectStorage storage = mock(ObjectStorage.class);
        Path destination = Path.of("/tmp/pron-test.m4a");
        new ObjectStoragePronunciationAudio(Optional.of(storage)).download("rec/1", destination);
        verify(storage).downloadToPath("rec/1", destination);
    }

    @Test
    void 스토리지가_없으면_던진다() {
        var audio = new ObjectStoragePronunciationAudio(Optional.empty());
        assertThatThrownBy(() -> audio.download("rec/1", Path.of("/tmp/x.m4a"))).isInstanceOf(NoCredentialsError.class);
    }
}
