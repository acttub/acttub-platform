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

    /** 다른 칸의 값에 따라 필수가 되는 칸이 빠졌을 때. Bean Validation 의 {@code @NotNull} 과 같은 모양이다. */
    public static ApiValidationException missing(List<Object> location, Object input) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "missing");
        error.put("loc", location);
        error.put("msg", "Field required");
        error.put("input", input);
        return new ApiValidationException(List.of(error));
    }

    public List<Map<String, Object>> detail() {
        return detail;
    }
}
