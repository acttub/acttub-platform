package com.acttub.actingapi.web;

import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.acttub.actingapi.storage.NoCredentialsError;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.introspect.BeanPropertyDefinition;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.WebUtils;
import com.acttub.actingapi.web.RequestBodyCachingFilter.CachedBodyRequest;

@RestControllerAdvice
public class ApiErrorAdvice {
    private final ObjectMapper mapper;

    public ApiErrorAdvice(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException exception) {
        return body(exception.status(), exception.getMessage());
    }

    @ExceptionHandler(NoCredentialsError.class)
    ResponseEntity<Map<String, Object>> credentials() {
        return body(503, "storage_not_configured");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> invalid(
            MethodArgumentNotValidException exception,
            HttpServletRequest request) {
        Object input = parsedBody(request);
        ValidationFields fields = validationFields(exception.getParameter().getParameterType());
        List<Map<String, Object>> errors = exception.getBindingResult().getFieldErrors().stream()
                .sorted(Comparator.comparingInt(error -> fields.orderOf(error.getField())))
                .map(error -> field(error, input, fields))
                .toList();
        return ResponseEntity.status(422).body(Map.of("detail", errors));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> malformed(
            HttpMessageNotReadableException exception,
            HttpServletRequest request) {
        Throwable cause = exception.getMostSpecificCause();
        String raw = rawBody(request);
        Map<String, Object> error = new LinkedHashMap<>();
        if (raw.isEmpty() && !(cause instanceof JsonProcessingException)) {
            error.put("type", "missing");
            error.put("loc", List.of("body"));
            error.put("msg", "Field required");
            error.put("input", null);
        } else if (cause instanceof MismatchedInputException mismatch && !mismatch.getPath().isEmpty()) {
            String field = mismatch.getPath().getFirst().getFieldName();
            error.put("type", "string_type");
            error.put("loc", List.of("body", field));
            error.put("msg", "Input should be a valid string");
            Object input = parsedBody(request);
            error.put("input", input instanceof Map<?, ?> map ? map.get(field) : null);
        } else {
            error.put("type", "json_invalid");
            error.put("loc", List.of("body", jacksonOffset(cause)));
            error.put("msg", "JSON decode error");
            error.put("input", Map.of());
            error.put("ctx", Map.of("error", jacksonError(exception, cause)));
        }
        return ResponseEntity.status(422).body(Map.of("detail", List.of(error)));
    }

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
    ResponseEntity<Map<String, Object>> notFound() {
        return body(404, "Not Found");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, Object>> method() {
        return body(405, "Method Not Allowed");
    }

    private Map<String, Object> field(FieldError error, Object input, ValidationFields fields) {
        Map<String, Object> value = new LinkedHashMap<>();
        String type = "NotNull".equals(error.getCode()) ? "missing" : "value_error";
        String message = "NotNull".equals(error.getCode())
                ? "Field required"
                : Objects.requireNonNullElse(error.getDefaultMessage(), "Invalid value");
        value.put("type", type);
        value.put("loc", List.of("body", fields.wireName(error.getField())));
        value.put("msg", message);
        value.put("input", input);
        return value;
    }

    private ValidationFields validationFields(Class<?> requestType) {
        List<BeanPropertyDefinition> properties = mapper.getDeserializationConfig()
                .introspect(mapper.constructType(requestType))
                .findProperties();
        Map<String, String> wireNames = new LinkedHashMap<>();
        Map<String, Integer> declarationOrder = new LinkedHashMap<>();
        for (int index = 0; index < properties.size(); index++) {
            BeanPropertyDefinition property = properties.get(index);
            wireNames.put(property.getInternalName(), property.getName());
            declarationOrder.put(property.getInternalName(), index);
            declarationOrder.putIfAbsent(property.getName(), index);
        }
        return new ValidationFields(wireNames, declarationOrder);
    }

    private Object parsedBody(HttpServletRequest request) {
        try {
            return mapper.readValue(rawBody(request), Object.class);
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private String rawBody(HttpServletRequest request) {
        // instanceof 로 직접 보면 안 된다 — Spring Security 필터체인이 요청을 다시 감싸므로
        // 우리 wrapper 가 체인 안쪽에 묻힌다. getNativeRequest 가 체인을 따라 내려가 찾아 준다.
        CachedBodyRequest cached = WebUtils.getNativeRequest(request, CachedBodyRequest.class);
        if (cached != null) {
            return new String(cached.body(), StandardCharsets.UTF_8);
        }
        // 필터가 어떤 이유로 빠졌을 때의 폴백. ContentCachingRequestWrapper 는 소비된 만큼만
        // 담기지만 부분 바디라도 없는 것보다 낫다.
        ContentCachingRequestWrapper partial =
                WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class);
        return partial == null ? "" : new String(partial.getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private static long jacksonOffset(Throwable cause) {
        if (cause instanceof JsonProcessingException processing && processing.getLocation() != null) {
            long byteOffset = processing.getLocation().getByteOffset();
            if (byteOffset >= 0) {
                return byteOffset;
            }
            long charOffset = processing.getLocation().getCharOffset();
            if (charOffset >= 0) {
                return charOffset;
            }
        }
        return 0;
    }

    private static String jacksonError(
            HttpMessageNotReadableException exception,
            Throwable cause) {
        if (cause instanceof JsonProcessingException processing) {
            return processing.getOriginalMessage();
        }
        return Objects.requireNonNullElse(exception.getMessage(), "Invalid JSON");
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String detail) {
        return ResponseEntity.status(status).body(Map.of("detail", detail));
    }

    private record ValidationFields(
            Map<String, String> wireNames,
            Map<String, Integer> declarationOrder) {
        String wireName(String field) {
            return wireNames.getOrDefault(field, field);
        }

        int orderOf(String field) {
            return declarationOrder.getOrDefault(field, Integer.MAX_VALUE);
        }
    }
}
