package com.acttub.actingapi.feature.video.app;

/**
 * video 가 오브젝트 스토리지에 요구하는 것 (ADR-017). 기기가 직접 올리고 직접 받아 간다 — 서버는 주소만
 * 내주고 무엇이 올라왔는지 확인한다.
 */
public interface VideoStorage {

    /** 설정이 없으면 503 {@code storage_not_configured} 를 던진다. */
    void requireConfigured();

    /** 기기가 PUT 할 주소. */
    String presignUpload(String objectKey, String contentType, long byteSize, int expiresInSeconds);

    /** 재생용 GET 주소. 스토리지가 없으면 {@code null}. */
    String presignPlayback(String objectKey, int expiresInSeconds);

    /** 올라온 객체의 크기와 검증값. 없으면 {@code null}. */
    Stored head(String objectKey);

    record Stored(long byteSize, String etag) {
    }
}
