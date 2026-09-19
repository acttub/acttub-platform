package com.acttub.actingapi.feature.portfolio.app;

/**
 * portfolio 가 오브젝트 스토리지에 요구하는 것. 사진 객체는 영상·프로필 사진과 같은 저장소에 두되 별개다.
 * 스토리지의 전체 표면이 아니라 이 도메인이 실제로 쓰는 것만 선언한다.
 */
public interface PortfolioPhotoStorage {

    /**
     * 스토리지가 설정돼 있지 않으면 즉시 던진다.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때
     */
    void requireConfigured();

    String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds);

    /** 올라온 것의 크기. 아직 없으면 {@code null}. */
    Long sizeOf(String objectKey);

    /** 사진을 볼 주소. 스토리지가 설정돼 있지 않으면 {@code null} — 조회가 그것 때문에 막히면 안 된다. */
    String viewUrl(String objectKey, int expiresInSeconds);

    void delete(String objectKey);
}
