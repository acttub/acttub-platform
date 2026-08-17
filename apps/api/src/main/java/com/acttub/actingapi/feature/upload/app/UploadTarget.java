package com.acttub.actingapi.feature.upload.app;

/**
 * upload 가 오브젝트 스토리지에 요구하는 것 — 올릴 자리를 내주고, 올라온 것을 확인한다.
 *
 * <p>스토리지의 전체 표면이 아니라 이 도메인이 실제로 쓰는 셋만 선언한다. 이 폭이 곧 이
 * 도메인이 바깥에 진 빚이다.
 */
public interface UploadTarget {

    /**
     * 스토리지가 설정돼 있지 않으면 즉시 던진다.
     *
     * <p><b>이 연산이 따로 있는 이유는 순서가 계약이기 때문이다.</b> 완료 요청은 의도를 조회하기
     * <b>전에</b> 스토리지 설정을 확인한다 — 나중으로 미루면 스토리지가 없는 기동에서 없는
     * 의도에 대한 응답이 스토리지 오류가 아니라 404 로 바뀐다.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 설정돼 있지 않을 때
     */
    void requireConfigured();

    /** 올릴 자리의 서명 주소. */
    String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds);

    /** 올라온 것의 크기와 지문. 아직 없으면 {@code null}. */
    StoredUpload head(String objectKey);
}
