package com.acttub.actingapi.platform.web;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import com.acttub.actingapi.platform.observability.FailureKind;

public class ApiException extends RuntimeException {
    private final int status;
    private final Map<String, String> headers;
    private final FailureKind failureKind;
    private final Map<String, Object> extras = new LinkedHashMap<>();

    public ApiException(int status, String detail) {
        this(status, detail, Map.of(), null, null);
    }

    public ApiException(int status, String detail, Throwable cause) {
        this(status, detail, Map.of(), cause, null);
    }

    public ApiException(int status, String detail, Map<String, String> headers) {
        this(status, detail, headers, null, null);
    }

    private ApiException(
            int status,
            String detail,
            Map<String, String> headers,
            Throwable cause,
            FailureKind failureKind) {
        super(detail, cause);
        if (status >= 500 && failureKind == null) {
            throw new IllegalArgumentException("5xx ApiException requires a failure factory");
        }
        this.status = status;
        this.headers = Map.copyOf(headers);
        this.failureKind = failureKind;
    }

    public static ApiException external(int status, String detail, Throwable cause) {
        return serverFailure(status, detail, cause, FailureKind.EXTERNAL);
    }

    public static ApiException unexpected(int status, String detail, Throwable cause) {
        return serverFailure(status, detail, cause, FailureKind.UNEXPECTED);
    }

    private static ApiException serverFailure(
            int status, String detail, Throwable cause, FailureKind failureKind) {
        if (status < 500 || status > 599) {
            throw new IllegalArgumentException("failure factory requires a 5xx status");
        }
        return new ApiException(
                status,
                detail,
                Map.of(),
                Objects.requireNonNull(cause, "cause"),
                failureKind);
    }

    /**
     * 본문에 {@code detail} 말고 하나를 더 싣는다.
     *
     * <p>⚠ <b>오류 본문은 {@code detail} 하나가 원칙이고 예외는 둘뿐이다</b>(apps/api/CONTRACT.md
     * §6) — 게이트의 {@code consent_required} 가 싣는 {@code pending_consents} 와 로그인의 이메일
     * 겹침 409 가 싣는 {@code providers}. 셋째를 더하기 전에 계약부터 고친다.
     */
    public ApiException with(String field, Object value) {
        extras.put(field, value);
        return this;
    }

    public int status() {
        return status;
    }

    /** {@code detail} 옆에 실을 형제 필드. 대부분의 오류는 비어 있다. */
    public Map<String, Object> extras() {
        return Collections.unmodifiableMap(extras);
    }

    public Map<String, String> headers() {
        return headers;
    }

    public Optional<FailureKind> failureKind() {
        return Optional.ofNullable(failureKind);
    }
}
