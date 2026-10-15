package com.acttub.actingapi.integration.airbridge;

/**
 * Airbridge 가 기기 한 대에 돌려준 설치 귀속. 광고를 가리키는 이름뿐이고 기기 ID 는 담지 않는다.
 *
 * @param channel 비어 있지 않다
 */
public record AirbridgeAttribution(
        String channel,
        String campaign,
        String adGroup,
        String adCreative,
        String content,
        String term,
        String subPublisher) {
}
