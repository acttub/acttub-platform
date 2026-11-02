package com.acttub.actingapi.feature.community.app;

/**
 * 게시판 사진이 오브젝트 스토리지에 요구하는 것. 포트폴리오 사진({@code PortfolioPhotoStorage})과 같은 모양이다.
 */
public interface CommunityImageStorage {

    /**
     * 스토리지가 설정돼 있지 않으면 즉시 던진다.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때
     */
    void requireConfigured();

    String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds);

    /** 올라온 것의 크기. 아직 없으면 {@code null}. */
    Long sizeOf(String objectKey);

    /** 사진을 볼 주소. 스토리지가 설정돼 있지 않으면 {@code null} — 글 조회가 그것 때문에 막히면 안 된다. */
    String viewUrl(String objectKey, int expiresInSeconds);
}
