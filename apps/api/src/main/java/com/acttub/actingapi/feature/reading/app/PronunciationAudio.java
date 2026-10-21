package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

/** 채점할 녹음을 내려받는다. 녹음 업로드 포트({@link RecordingStorage})와 따로 두어 기존 포트를 넓히지 않는다. */
public interface PronunciationAudio {

    void download(String objectKey, Path destination);
}
