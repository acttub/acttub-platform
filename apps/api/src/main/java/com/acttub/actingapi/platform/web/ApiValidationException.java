package com.acttub.actingapi.platform.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** FastAPI/Pydantic 형상으로 직접 표현해야 하는 도메인 validation 오류. */
public class ApiValidationException extends RuntimeException {
    private final List<Map<String, Object>> detail;

    public ApiValidationException(List<Map<String, Object>> detail) {
        super("request validation failed");
        this.detail = List.copyOf(detail);
    }

    public static ApiValidationException valueError(
            List<Object> location,
            String message,
            Object input) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "value_error");
        error.put("loc", location);
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", Map.of("error", Map.of()));
        return new ApiValidationException(List.of(error));
    }

    public List<Map<String, Object>> detail() {
        return detail;
    }
}
