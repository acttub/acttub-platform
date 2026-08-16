package com.acttub.actingapi.platform.web;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * 멱등 동기 요청의 200 응답을 조립한다 — canonical JSON 본문에 요청 ID 를 되돌려 붙인다.
 *
 * <p>처음 처리한 응답과 나중에 재생한 응답이 <b>바이트까지 같아야</b> 한다. 그래서 두 자리가 같은
 * 조립기를 쓰며, 이 클래스가 그 한 자리다.
 *
 * <p>원장 서비스가 아니라 배관에 산다(ADR-017, SOMA-397 6단계). 오퍼레이션 원장은 무엇을 언제
 * 다시 실어 보낼지만 정하고, 그것을 HTTP 로 옮기는 일은 컨트롤러 쪽 관심사다.
 */
@Component
public class CanonicalJsonResponse {

    private final CanonicalJson canonical;

    public CanonicalJsonResponse(CanonicalJson canonical) {
        this.canonical = canonical;
    }

    public ResponseEntity<byte[]> ok(JsonNode payload, UUID requestId) {
        return ResponseEntity.status(HttpStatus.OK)
                .header("X-Request-Id", requestId.toString())
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .body(canonical.bytes(payload));
    }
}
