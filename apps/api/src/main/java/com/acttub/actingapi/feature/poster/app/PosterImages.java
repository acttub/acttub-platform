package com.acttub.actingapi.feature.poster.app;

/**
 * 포스터가 오브젝트 스토리지에 요구하는 것 — 운영자가 올릴 자리와 앱이 볼 한시적 주소.
 *
 * <p>보는 주소는 실패를 {@code null} 로 알린다. 이미지는 포스터의 곁가지라 서명이 안 돼도 목록은 나가야 한다 —
 * 그때 앱은 이미지 칸을 숨긴다.
 */
public interface PosterImages {

    /**
     * 스토리지가 설정돼 있지 않으면 즉시 던진다.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때
     */
    String presignUpload(String objectKey, String contentType, long sizeBytes, int expiresInSeconds);

    /** 만들 수 없으면 {@code null}. */
    String viewUrl(String objectKey, int expiresInSeconds);
}
