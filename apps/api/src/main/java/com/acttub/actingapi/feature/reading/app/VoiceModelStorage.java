package com.acttub.actingapi.feature.reading.app;

/** 리딩 기기 목소리 모델 파일을 둔 비공개 저장소(SOMA-747). 앱은 서명된 임시 주소로만 받는다. */
public interface VoiceModelStorage {
    boolean configured();

    String downloadUrl(String key, int expiresInSeconds);
}
