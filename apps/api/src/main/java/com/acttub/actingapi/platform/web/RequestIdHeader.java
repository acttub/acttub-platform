package com.acttub.actingapi.platform.web;

import java.util.List;
import java.util.UUID;

/**
 * 클라이언트는 요청 id 를 본문과 {@code X-Request-Id} 헤더에 같은 값으로 싣는다. 헤더는 없어도 되지만 있으면 본문과
 * 같아야 한다 — 다르면 어느 쪽이 재전송의 열쇠인지 알 수 없어 본문의 모양이 틀린 것으로 본다(422 배열). 연습·리딩·
 * 보관함의 요청 id 를 받는 쓰기가 같은 규칙을 쓴다.
 */
public final class RequestIdHeader {
    public static final String NAME = "X-Request-Id";

    private RequestIdHeader() {
    }

    public static void requireMatching(String header, UUID requestId) {
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
