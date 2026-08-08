package com.acttub.actingapi.web;

import java.util.List;
import java.util.Map;

/** FastAPI/Pydantic 형상으로 직접 표현해야 하는 도메인 validation 오류. */
public class ApiValidationException extends RuntimeException {
    private final List<Map<String, Object>> detail;

    public ApiValidationException(List<Map<String, Object>> detail) {
        super("request validation failed");
        this.detail = List.copyOf(detail);
    }

    public List<Map<String, Object>> detail() {
        return detail;
    }
}
