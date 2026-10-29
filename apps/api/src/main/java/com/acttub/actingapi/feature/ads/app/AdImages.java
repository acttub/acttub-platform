package com.acttub.actingapi.feature.ads.app;

/** 광고 이미지가 오브젝트 스토리지에 요구하는 것 — 운영자가 올릴 자리와 앱이 볼 한시적 주소. */
public interface AdImages {

    /** @throws com.acttub.actingapi.integration.storage.NoCredentialsError 스토리지가 설정돼 있지 않을 때 */
    String presignUpload(String objectKey, String contentType, long sizeBytes, int expiresInSeconds);

    /** 만들 수 없으면 {@code null}. */
    String viewUrl(String objectKey, int expiresInSeconds);

    /** 저장된 이미지 값 → 앱이 볼 주소. {@code ads/} 키는 1시간짜리 서명 주소로, http(s) 주소는 그대로. 만들 수 없으면 null. */
    default String urlFor(String reference) {
        if (reference == null || reference.isBlank()) {
            return null;
        }
        return reference.startsWith("ads/") ? viewUrl(reference, 3600) : reference;
    }
}
