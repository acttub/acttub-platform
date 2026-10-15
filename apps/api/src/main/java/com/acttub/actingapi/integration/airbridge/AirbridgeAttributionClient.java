package com.acttub.actingapi.integration.airbridge;

import java.util.Optional;

/**
 * Airbridge 설치 귀속 조회 API({@code attribution-result/v1}) — 기기 ID 하나로 그 기기의 귀속을 묻는다.
 * 기기 ID 는 Airbridge Device ID(안드로이드 GAID, iOS IDFA/IDFV)여야 한다.
 */
public interface AirbridgeAttributionClient {

    /** API 토큰이 설정돼 있는가. 꺼져 있으면 기기 ID 를 받아 두지도, 조회하지도 않는다. */
    boolean enabled();

    /**
     * @return 귀속 채널이 있으면 그 값, 아직 없으면(204·빈 채널) 빈 값
     * @throws AirbridgeUnavailable 토큰이 없거나 Airbridge 가 답하지 않거나 거절했다
     */
    Optional<AirbridgeAttribution> lookup(String deviceUuid);
}
