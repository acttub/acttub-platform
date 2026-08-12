package com.acttub.actingapi.web;

import java.util.Map;

public class ApiException extends RuntimeException {
    private final int status;
    private final Map<String, String> headers;

    public ApiException(int status, String detail) {
        this(status, detail, Map.of());
    }

    public ApiException(int status, String detail, Map<String, String> headers) {
        super(detail);
        this.status = status;
        this.headers = Map.copyOf(headers);
    }

    public int status() {
        return status;
    }

    public Map<String, String> headers() {
        return headers;
    }
}
