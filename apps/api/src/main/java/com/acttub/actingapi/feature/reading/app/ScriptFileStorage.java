package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

/**
 * reading 이 오브젝트 스토리지에 요구하는 것 — 대본 원본 파일 (reading.script 「원본 파일」). 기기가 서명한 주소로 직접 올리고,
 * 서버는 올라온 것을 받아 글자를 뽑는다.
 */
public interface ScriptFileStorage {

    /** @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때(503) */
    void requireConfigured();

    String presignUpload(String objectKey, String contentType, long byteSize, int expiresInSeconds);

    /** 올라온 객체의 크기. 아직 없으면 {@code null}. */
    Long size(String objectKey);

    /** 객체를 {@code destination} 에 받는다. 이미 있는 파일은 덮어쓴다. */
    void download(String objectKey, Path destination);
}
