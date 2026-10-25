package com.acttub.actingapi.feature.support.adapter.web;

import java.time.Duration;
import java.util.UUID;

import com.acttub.actingapi.feature.support.adapter.web.SupportInquiryDtos.SupportInquiryRequest;
import com.acttub.actingapi.feature.support.adapter.web.SupportInquiryDtos.SupportInquiryResponse;
import com.acttub.actingapi.feature.support.app.SupportInquiryRules;
import com.acttub.actingapi.feature.support.app.SupportInquiryService;
import com.acttub.actingapi.feature.support.app.SupportInquiryService.Accepted;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.ClientVersionFilter;
import com.acttub.actingapi.platform.security.CurrentUserService;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 웹 문의하기 (app.support-inquiry). 로그인 없이 받는다 — {@code AccessTokenFilter} 가 이 경로를 건너뛰므로
 * 만료·잘못된 토큰이 붙어 와도 막히지 않는다. 유효한 토큰이 붙어 있을 때만 user_id 를 남긴다.
 */
@RestController
class SupportInquiryController {

    private final SupportInquiryService inquiries;
    private final CurrentUserService users;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    SupportInquiryController(
            SupportInquiryService inquiries,
            CurrentUserService users,
            FixedWindowRateLimiter limiter,
            ClientAddress addresses) {
        this.inquiries = inquiries;
        this.users = users;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @Operation(
            summary = "Submit Support Inquiry",
            description = """
                    웹 문의하기를 접수한다. <b>로그인 없이 받는다</b> — 유효한 액세스 토큰이 붙어 있으면 계정을 함께
                    남기고, 없거나 만료·잘못된 토큰이면 비로그인 문의로 받는다. 한 IP 에서 10분에 5건까지다.
                    메일은 보내지 않는다.""",
            operationId = "submit_support_inquiry_v2_support_inquiries_post",
            tags = "v2-support")
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = SupportInquiryResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/v2/support/inquiries")
    ResponseEntity<SupportInquiryResponse> submit(
            @Valid @RequestBody SupportInquiryRequest body, HttpServletRequest request) {
        if (!limiter.allow(
                "support-inquiry-ip:" + addresses.of(request),
                SupportInquiryRules.PER_IP_LIMIT,
                Duration.ofMinutes(SupportInquiryRules.WINDOW_MINUTES))) {
            throw new ApiException(429, "rate limit exceeded");
        }
        Accepted accepted = inquiries.submit(
                body.category(), body.email(), body.body(), optionalUserId(request),
                request.getHeader(ClientVersionFilter.HEADER));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new SupportInquiryResponse(accepted.id(), accepted.createdAt()));
    }

    /** 유효한 토큰이면 그 계정, 아니면 비로그인이다. 어떤 실패도 접수를 막지 않는다. */
    private UUID optionalUserId(HttpServletRequest request) {
        if (request.getHeader("Authorization") == null) {
            return null;
        }
        try {
            return users.require(request).id();
        } catch (ApiException anonymous) {
            return null;
        }
    }
}
