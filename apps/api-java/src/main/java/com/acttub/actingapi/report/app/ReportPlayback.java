package com.acttub.actingapi.report.app;

/**
 * report 가 오브젝트 스토리지에 요구하는 것 — 녹화본을 재생할 한시적 주소 하나.
 *
 * <p>{@code practice} 가 같은 모양의 포트를 따로 갖는다. 합치지 않는 이유는 그것이 도메인 사이의
 * 공유가 되기 때문이다 — 한쪽이 수명이나 실패 처리를 바꾸고 싶어지는 날, 공유된 포트는 그 변경을
 * 상대에게 강요한다.
 */
public interface ReportPlayback {

    /**
     * 주어진 오브젝트를 재생할 서명 주소.
     *
     * @throws com.acttub.actingapi.integration.storage.NoCredentialsError 스토리지가 설정돼 있지 않을 때
     */
    String url(String objectKey, int expiresInSeconds);
}
