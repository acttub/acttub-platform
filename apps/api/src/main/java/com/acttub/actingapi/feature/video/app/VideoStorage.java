package com.acttub.actingapi.feature.video.app;

import java.nio.file.Path;

/**
 * video 가 오브젝트 스토리지에 요구하는 것 (ADR-017). 기기가 직접 올리고 직접 받아 간다 — 서버는 주소만
 * 내주고 무엇이 올라왔는지 확인한다. 서버가 직접 받고 올리는 것은 포스터 하나다(영상을 받아 한 장면을 뽑아 올린다).
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

    /** 스토리지가 있는가. 없는 기동(로컬·일부 테스트)에서 포스터 워커는 아무것도 집지 않는다. */
    boolean configured();

    /** 객체를 {@code destination} 에 받는다. 이미 있는 파일은 덮어쓴다. */
    void download(String objectKey, Path destination);

    /** 서버가 만든 파일을 올린다. 같은 키에 다시 올리면 덮어쓴다. */
    void upload(String objectKey, String contentType, Path source);

    record Stored(long byteSize, String etag) {
    }
}
