package com.acttub.actingapi.feature.blog.app;

/** 블로그가 오브젝트 스토리지에 요구하는 것 — 서버가 직접 올리고, 읽을 때 한시적 주소를 받는다. */
public interface BlogImages {

    /**
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 스토리지가 설정돼 있지 않을 때
     */
    void upload(String objectKey, String contentType, byte[] content);

    /** 만들 수 없으면 {@code null}. */
    String viewUrl(String objectKey, int expiresInSeconds);
}
