package com.acttub.actingapi.platform.web;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import com.acttub.actingapi.platform.observability.FailureKind;

public class ApiException extends RuntimeException {
    private final int status;
    private final Map<String, String> headers;
    private final FailureKind failureKind;

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

    public int status() {
        return status;
    }

    public Map<String, String> headers() {
        return headers;
    }

    public Optional<FailureKind> failureKind() {
        return Optional.ofNullable(failureKind);
    }
}
