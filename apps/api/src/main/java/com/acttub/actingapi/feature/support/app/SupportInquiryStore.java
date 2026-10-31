package com.acttub.actingapi.feature.support.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 문의 저장소 — {@code support_inquiries} (app.support-inquiry, V63). */
public interface SupportInquiryStore {

    void insert(NewInquiry inquiry, Instant now);

    /** 한 계정이 보낸 문의, 새것부터. */
    List<Inquiry> listByUser(UUID userId, int limit);

    /** 새것부터. {@code status} 가 {@code null} 이면 전체. */
    List<Inquiry> list(String status, int limit);

    /** @param userId 유효한 액세스 토큰이 붙어 왔을 때만. 비로그인이면 {@code null} */
    record NewInquiry(UUID id, String category, String email, String body, UUID userId, String client) {
    }

    record Inquiry(
            UUID id,
            String category,
            String email,
            String body,
            UUID userId,
            String client,
            String status,
            Instant createdAt) {
    }
}
