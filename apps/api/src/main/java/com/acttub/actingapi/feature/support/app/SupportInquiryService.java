package com.acttub.actingapi.feature.support.app;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.support.app.SupportInquiryStore.Inquiry;
import com.acttub.actingapi.feature.support.app.SupportInquiryStore.NewInquiry;
import com.acttub.actingapi.platform.text.InputCharset;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.springframework.stereotype.Service;

/**
 * 로그인 없이 받는 웹 문의 (app.support-inquiry). 접수는 DB 커밋으로 끝나고 메일은 보내지 않는다.
 * 이메일·본문은 개인정보라 로그에 남기지 않는다.
 */
@Service
public class SupportInquiryService {

    private final SupportInquiryStore store;
    private final Clock clock;

    public SupportInquiryService(SupportInquiryStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
    }

    public record Accepted(UUID id, Instant createdAt) {
    }

    /** 본문은 다듬은 뒤 길이를 본다 — 공백만 채운 10자는 10자가 아니다. */
    public Accepted submit(String category, String email, String body, UUID userId, String client) {
        InputCharset.require(body);
        String trimmedEmail = SupportInquiryRules.normalize(email);
        String trimmedBody = SupportInquiryRules.normalize(body);
        int length = trimmedBody == null ? 0 : SupportInquiryRules.length(trimmedBody);
        if (length < SupportInquiryRules.BODY_MIN_CHARS || length > SupportInquiryRules.BODY_MAX_CHARS) {
            throw ApiValidationException.valueError(
                    List.of("body", "body"),
                    "Value error, body must be %d to %d characters".formatted(
                            SupportInquiryRules.BODY_MIN_CHARS, SupportInquiryRules.BODY_MAX_CHARS),
                    body);
        }
        if (trimmedEmail == null
                || trimmedEmail.length() > SupportInquiryRules.EMAIL_MAX_CHARS
                || !trimmedEmail.matches(SupportInquiryRules.EMAIL_PATTERN)) {
            throw ApiValidationException.valueError(
                    List.of("body", "email"), "Value error, email must be a valid email address", email);
        }
        String trimmedClient = SupportInquiryRules.normalize(client);
        if (trimmedClient != null && trimmedClient.length() > SupportInquiryRules.CLIENT_MAX_CHARS) {
            trimmedClient = trimmedClient.substring(0, SupportInquiryRules.CLIENT_MAX_CHARS);
        }
        UUID id = UUID.randomUUID();
        Instant now = clock.instant();
        store.insert(new NewInquiry(id, category, trimmedEmail, trimmedBody, userId, trimmedClient), now);
        return new Accepted(id, now);
    }

    /** 로그인한 계정이 보낸 문의, 새것부터 {@link SupportInquiryRules#MINE_LIMIT} 건. */
    public List<Inquiry> mine(UUID userId) {
        return store.listByUser(userId, SupportInquiryRules.MINE_LIMIT);
    }

    public List<Inquiry> list(String status, int limit) {
        return store.list(status, limit);
    }
}
