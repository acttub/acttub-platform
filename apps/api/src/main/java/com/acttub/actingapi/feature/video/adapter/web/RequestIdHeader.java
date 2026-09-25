package com.acttub.actingapi.feature.video.adapter.web;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiValidationException;

/**
 * 기기는 요청 id 를 본문과 {@code X-Request-Id} 헤더에 같은 값으로 싣는다. 헤더는 없어도 되지만 있으면 본문과
 * 같아야 한다 — 다르면 어느 쪽이 재전송의 열쇠인지 알 수 없어 본문의 모양이 틀린 것으로 본다(422 배열).
 * 리딩의 같은 이름 helper 와 같은 규칙이다.
 */
final class RequestIdHeader {
    static final String NAME = "X-Request-Id";

    private RequestIdHeader() {
    }

    static void requireMatching(String header, UUID requestId) {
        if (header == null || header.isBlank()) {
            return;
        }
        UUID fromHeader;
        try {
            fromHeader = UUID.fromString(header.strip());
        } catch (IllegalArgumentException malformed) {
            fromHeader = null;
        }
        if (!requestId.equals(fromHeader)) {
            throw ApiValidationException.valueError(
                    List.of("header", NAME),
                    "Value error, X-Request-Id must equal body.request_id",
                    header);
        }
    }
}
