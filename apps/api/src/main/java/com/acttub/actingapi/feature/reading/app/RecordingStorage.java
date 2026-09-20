package com.acttub.actingapi.feature.reading.app;

import java.nio.file.Path;

/**
 * reading 이 오브젝트 스토리지에 요구하는 것 — 녹음 객체 (reading.recording).
 *
 * <p>스토리지의 전체 표면이 아니라 이 도메인이 실제로 쓰는 것만 선언한다({@code portfolio/app/PortfolioPhotoStorage}
 * 와 같은 형태). 녹음은 작아서 서버가 직접 올린다 — 영상처럼 올릴 자리를 따로 받지 않는다.
 */
public interface RecordingStorage {

    /**
     * 스토리지가 설정돼 있지 않으면 즉시 던진다.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때
     */
    void requireConfigured();

    /** 변환을 마친 m4a 를 올린다. 같은 키에 다시 올리면 덮어쓴다(키는 요청마다 달라 실제로는 없다). */
    void upload(String objectKey, String contentType, Path source);

    /** 재생 서명 주소. 스토리지가 설정돼 있지 않으면 {@code null} — 회차 조회가 그것 때문에 막히면 안 된다. */
    String playbackUrl(String objectKey, int expiresInSeconds);
}
