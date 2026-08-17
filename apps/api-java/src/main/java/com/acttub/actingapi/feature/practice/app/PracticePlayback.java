package com.acttub.actingapi.feature.practice.app;

/**
 * practice 가 오브젝트 스토리지에 요구하는 것 — 녹화본을 재생할 수 있는 한시적 주소 하나.
 *
 * <p>스토리지의 전체 표면({@code head}·{@code delete}·업로드 서명)이 아니라 practice 가 실제로 쓰는
 * 한 가지만 선언한다. 이 폭이 곧 이 도메인이 바깥에 진 빚이다.
 */
public interface PracticePlayback {

    /**
     * 주어진 오브젝트를 재생할 서명 주소.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 스토리지가 설정돼 있지 않을 때
     */
    String url(String objectKey, int expiresInSeconds);
}
