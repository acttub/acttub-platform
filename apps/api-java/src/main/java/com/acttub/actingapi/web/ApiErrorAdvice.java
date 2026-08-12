package com.acttub.actingapi.web;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.storage.NoCredentialsError;
import com.acttub.actingapi.web.RequestBodyCachingFilter.CachedBodyRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.fasterxml.jackson.databind.introspect.BeanPropertyDefinition;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.WebUtils;

@RestControllerAdvice
public class ApiErrorAdvice {
    private static final int UNKNOWN_ORDER = Integer.MAX_VALUE;

    private final ObjectMapper mapper;

    public ApiErrorAdvice(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException exception) {
        var response = ResponseEntity.status(exception.status());
        exception.headers().forEach(response::header);
        return response.body(Map.of("detail", exception.getMessage()));
    }

    @ExceptionHandler(ApiValidationException.class)
    ResponseEntity<Map<String, Object>> validation(ApiValidationException exception) {
        return ResponseEntity.status(422).body(Map.of("detail", exception.detail()));
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
        JavaType requestType = mapper.constructType(exception.getParameter().getParameterType());
        List<ResolvedFieldError> resolved = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> new ResolvedFieldError(error, resolveBeanPath(requestType, error.getField())))
                .sorted((left, right) -> compareOrder(left.path().order(), right.path().order()))
                .toList();
        List<Map<String, Object>> errors = new ArrayList<>(resolved.stream()
                .map(error -> field(error.error(), error.path(), input))
                .toList());
        exception.getBindingResult().getGlobalErrors().stream()
                .map(error -> global(error, input))
                .forEach(errors::add);
        return ResponseEntity.status(422).body(Map.of("detail", errors));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> malformed(
            HttpMessageNotReadableException exception,
            HttpServletRequest request) {
        Throwable cause = exception.getMostSpecificCause();
        String raw = rawBody(request);
        Map<String, Object> error;
        if (raw.isEmpty() && !(cause instanceof JsonProcessingException)) {
            error = error("missing", List.of("body"), "Field required", null);
        } else if (cause instanceof JsonMappingException mapping && !mapping.getPath().isEmpty()) {
            Object input = parsedBody(request);
            ResolvedPath path = resolveJacksonPath(mapping.getPath());
            error = jacksonError(mapping, path.loc(), valueAt(input, path.loc()));
        } else {
            error = error(
                    "json_invalid",
                    List.of("body", jacksonOffset(cause)),
                    "JSON decode error",
                    Map.of());
            error.put("ctx", Map.of("error", jacksonParserError(exception, cause)));
        }
        return ResponseEntity.status(422).body(Map.of("detail", List.of(error)));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Map<String, Object>> pathType(MethodArgumentTypeMismatchException exception) {
        if (exception.getRequiredType() == UUID.class) {
            Object input = exception.getValue();
            String parserError = uuidParserError(input, exception.getMessage());
            Map<String, Object> error = error(
                    "uuid_parsing",
                    List.of("path", exception.getName()),
                    "Input should be a valid UUID, " + parserError,
                    input);
            error.put("ctx", Map.of("error", parserError));
            return ResponseEntity.status(422).body(Map.of("detail", List.of(error)));
        }
        if (exception.getRequiredType() == Integer.class
                || exception.getRequiredType() == int.class) {
            // 쿼리 정수 파싱 실패는 pydantic 의 int_parsing 이다. 여기서 걸러내지 않으면
            // Spring 의 "Failed to convert value of type ..." 문자열이 그대로 나가고,
            // loc 도 query 가 아니라 path 로 잘못 붙는다.
            return ResponseEntity.status(422).body(Map.of("detail", List.of(error(
                    "int_parsing",
                    List.of("query", exception.getName()),
                    "Input should be a valid integer, unable to parse string as an integer",
                    exception.getValue()))));
        }
        return ResponseEntity.status(422).body(Map.of("detail", List.of(error(
                "value_error",
                List.of("path", exception.getName()),
                Objects.requireNonNullElse(exception.getMessage(), "Invalid value"),
                exception.getValue()))));
    }

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
    ResponseEntity<Map<String, Object>> notFound() {
        return body(404, "Not Found");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, Object>> method() {
        return body(405, "Method Not Allowed");
    }

    private Map<String, Object> field(FieldError field, ResolvedPath path, Object bodyInput) {
        boolean missing = "NotNull".equals(field.getCode());
        String type = validationType(field.getCode());
        String message = missing ? "Field required"
                : Objects.requireNonNullElse(field.getDefaultMessage(), "Invalid value");
        Object input = valueAt(bodyInput, path.loc(), missing);
        Map<String, Object> value = error(type, path.loc(), message, input);
        if ("Positive".equals(field.getCode())) {
            value.put("ctx", Map.of("gt", 0));
        } else if ("Size".equals(field.getCode())) {
            value.put("ctx", Map.of("min_length", 1));
        }
        return value;
    }

    private static Map<String, Object> global(ObjectError error, Object bodyInput) {
        String reason = Objects.requireNonNullElse(error.getDefaultMessage(), "Invalid value");
        Map<String, Object> value = error(
                "value_error",
                List.of("body"),
                "Value error, " + reason,
                bodyInput);
        // ctx.error 는 사유 문자열이 아니라 **빈 객체**다. pydantic 의 ctx["error"] 는 ValueError
        // 객체이고 FastAPI 의 jsonable_encoder 가 그것을 인코딩하지 못해 {} 를 내보낸다(실측).
        // 사유는 msg 의 "Value error, " 뒤에만 남는다. ApiValidationException.valueError 와 같은 형태다.
        value.put("ctx", Map.of("error", Map.of()));
        return value;
    }

    private static String validationType(String code) {
        if ("NotNull".equals(code)) {
            return "missing";
        }
        if ("Positive".equals(code)) {
            return "greater_than";
        }
        if ("Size".equals(code)) {
            return "string_too_short";
        }
        return "value_error";
    }

    Map<String, Object> jacksonError(
            JsonMappingException exception,
            List<Object> loc,
            Object input) {
        if (exception instanceof UnrecognizedPropertyException) {
            return error("extra_forbidden", loc, "Extra inputs are not permitted", input);
        }

        Class<?> target = exception instanceof MismatchedInputException mismatch
                ? mismatch.getTargetType()
                : null;
        if (target == String.class) {
            return error("string_type", loc, "Input should be a valid string", input);
        }
        if (target == boolean.class || target == Boolean.class) {
            return error("bool_type", loc, "Input should be a valid boolean", input);
        }
        if (isIntegral(target)) {
            if (hasFractionalPart(input)) {
                return error(
                        "int_from_float",
                        loc,
                        "Input should be a valid integer, got a number with a fractional part",
                        input);
            }
            return error(
                    input instanceof String ? "int_parsing" : "int_type",
                    loc,
                    input instanceof String
                            ? "Input should be a valid integer, unable to parse string as an integer"
                            : "Input should be a valid integer",
                    input);
        }
        if (target == UUID.class) {
            String parserError = uuidParserError(input, exception);
            Map<String, Object> value = error(
                    "uuid_parsing",
                    loc,
                    "Input should be a valid UUID, " + parserError,
                    input);
            value.put("ctx", Map.of("error", parserError));
            return value;
        }
        if (target != null && target.isEnum()) {
            String expected = enumExpected(target);
            Map<String, Object> value = error(
                    "enum",
                    loc,
                    "Input should be " + expected,
                    input);
            value.put("ctx", Map.of("expected", expected));
            return value;
        }
        return error(
                "value_error",
                loc,
                Objects.requireNonNullElse(exception.getOriginalMessage(), "Invalid value"),
                input);
    }

    Map<String, Object> nullTypeError(Class<?> target, List<Object> loc) {
        if (target == String.class) {
            return error("string_type", loc, "Input should be a valid string", null);
        }
        if (target == boolean.class || target == Boolean.class) {
            return error("bool_type", loc, "Input should be a valid boolean", null);
        }
        if (isIntegral(target)) {
            return error("int_type", loc, "Input should be a valid integer", null);
        }
        if (target == float.class || target == Float.class
                || target == double.class || target == Double.class
                || target == java.math.BigDecimal.class) {
            return error("float_type", loc, "Input should be a valid number", null);
        }
        if (target == UUID.class) {
            return error(
                    "uuid_type",
                    loc,
                    "UUID input should be a string, bytes or UUID object",
                    null);
        }
        if (target.isEnum()) {
            String expected = enumExpected(target);
            Map<String, Object> value = error(
                    "enum", loc, "Input should be " + expected, null);
            value.put("ctx", Map.of("expected", expected));
            return value;
        }
        if (Collection.class.isAssignableFrom(target) || target.isArray()) {
            return error("list_type", loc, "Input should be a valid list", null);
        }
        if (Map.class.isAssignableFrom(target)) {
            return error("dict_type", loc, "Input should be a valid dictionary", null);
        }
        return error(
                "model_type",
                loc,
                "Input should be a valid dictionary or object to extract fields from",
                null);
    }

    private ResolvedPath resolveJacksonPath(List<JsonMappingException.Reference> references) {
        List<Object> loc = new ArrayList<>();
        loc.add("body");
        JavaType current = references.isEmpty() ? null : referenceType(references.getFirst(), null);
        for (JsonMappingException.Reference reference : references) {
            if (reference.getFieldName() != null) {
                JavaType owner = referenceType(reference, current);
                BeanPropertyDefinition property = property(owner, reference.getFieldName());
                loc.add(property == null ? reference.getFieldName() : property.getName());
                current = property == null ? current : property.getPrimaryType();
            } else if (reference.getIndex() >= 0) {
                loc.add(reference.getIndex());
                if (current != null && current.getContentType() != null) {
                    current = current.getContentType();
                }
            }
        }
        return new ResolvedPath(List.copyOf(loc), List.of());
    }

    private ResolvedPath resolveBeanPath(JavaType rootType, String beanPath) {
        List<Object> loc = new ArrayList<>();
        List<Integer> order = new ArrayList<>();
        loc.add("body");
        JavaType current = rootType;
        for (Object segment : beanPathSegments(beanPath)) {
            if (segment instanceof Integer index) {
                loc.add(index);
                order.add(index);
                if (current != null && current.getContentType() != null) {
                    current = current.getContentType();
                }
                continue;
            }
            String field = (String) segment;
            List<BeanPropertyDefinition> properties = properties(current);
            BeanPropertyDefinition property = properties.stream()
                    .filter(candidate -> candidate.getInternalName().equals(field)
                            || candidate.getName().equals(field))
                    .findFirst()
                    .orElse(null);
            loc.add(property == null ? field : property.getName());
            order.add(property == null ? UNKNOWN_ORDER : properties.indexOf(property));
            current = property == null ? current : property.getPrimaryType();
        }
        return new ResolvedPath(List.copyOf(loc), List.copyOf(order));
    }

    private BeanPropertyDefinition property(JavaType owner, String name) {
        return properties(owner).stream()
                .filter(candidate -> candidate.getInternalName().equals(name)
                        || candidate.getName().equals(name))
                .findFirst()
                .orElse(null);
    }

    private List<BeanPropertyDefinition> properties(JavaType type) {
        if (type == null || type.isPrimitive() || type.isCollectionLikeType() || type.isMapLikeType()) {
            return List.of();
        }
        return mapper.getDeserializationConfig().introspect(type).findProperties();
    }

    private JavaType referenceType(JsonMappingException.Reference reference, JavaType fallback) {
        Object from = reference.getFrom();
        if (from instanceof Class<?> type) {
            return mapper.constructType(type);
        }
        if (from != null
                && !(from instanceof Map<?, ?>)
                && !(from instanceof Collection<?>)) {
            return mapper.constructType(from.getClass());
        }
        return fallback;
    }

    private static List<Object> beanPathSegments(String path) {
        List<Object> result = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        for (int index = 0; index < path.length(); index++) {
            char current = path.charAt(index);
            if (current == '.') {
                addField(result, field);
            } else if (current == '[') {
                addField(result, field);
                int end = path.indexOf(']', index);
                if (end < 0) {
                    field.append(path.substring(index));
                    break;
                }
                String key = path.substring(index + 1, end);
                try {
                    result.add(Integer.parseInt(key));
                } catch (NumberFormatException ignored) {
                    result.add(key);
                }
                index = end;
            } else {
                field.append(current);
            }
        }
        addField(result, field);
        return result;
    }

    private static void addField(List<Object> path, StringBuilder field) {
        if (!field.isEmpty()) {
            path.add(field.toString());
            field.setLength(0);
        }
    }

    private static int compareOrder(List<Integer> left, List<Integer> right) {
        int common = Math.min(left.size(), right.size());
        for (int index = 0; index < common; index++) {
            int compared = Integer.compare(left.get(index), right.get(index));
            if (compared != 0) {
                return compared;
            }
        }
        return Integer.compare(left.size(), right.size());
    }

    private static Object valueAt(Object body, List<Object> loc) {
        return valueAt(body, loc, false);
    }

    private static Object valueAt(Object body, List<Object> loc, boolean enclosingObject) {
        Object current = body;
        int end = loc.size() - (enclosingObject ? 1 : 0);
        for (int index = 1; index < end; index++) {
            Object segment = loc.get(index);
            if (segment instanceof String field && current instanceof Map<?, ?> map) {
                current = map.get(field);
            } else if (segment instanceof Integer item && current instanceof List<?> list
                    && item >= 0 && item < list.size()) {
                current = list.get(item);
            } else {
                return null;
            }
        }
        return current;
    }

    private static boolean isIntegral(Class<?> type) {
        return type == byte.class || type == Byte.class
                || type == short.class || type == Short.class
                || type == int.class || type == Integer.class
                || type == long.class || type == Long.class
                || type == java.math.BigInteger.class;
    }

    private static boolean hasFractionalPart(Object input) {
        if (!(input instanceof Number number) || input instanceof Byte || input instanceof Short
                || input instanceof Integer || input instanceof Long || input instanceof java.math.BigInteger) {
            return false;
        }
        try {
            return new java.math.BigDecimal(number.toString()).stripTrailingZeros().scale() > 0;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static String uuidParserError(Object input, JsonMappingException exception) {
        return uuidParserError(input, exception.getOriginalMessage());
    }

    private static String uuidParserError(Object input, String fallback) {
        if (input instanceof String value) {
            for (int index = 0; index < value.length(); index++) {
                char character = value.charAt(index);
                if (Character.digit(character, 16) < 0 && character != '-') {
                    return "invalid character: found `" + character + "` at " + (index + 1);
                }
            }
        }
        return Objects.requireNonNullElse(fallback, "invalid UUID");
    }

    private String enumExpected(Class<?> enumType) {
        List<String> values = new ArrayList<>();
        for (Object constant : enumType.getEnumConstants()) {
            JsonNode serialized = mapper.valueToTree(constant);
            String value = serialized.isTextual() ? serialized.textValue() : constant.toString();
            values.add("'" + value + "'");
        }
        if (values.size() < 2) {
            return values.isEmpty() ? "a valid enum value" : values.getFirst();
        }
        return String.join(", ", values.subList(0, values.size() - 1))
                + " or " + values.getLast();
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

    private static String jacksonParserError(
            HttpMessageNotReadableException exception,
            Throwable cause) {
        if (cause instanceof JsonProcessingException processing) {
            return processing.getOriginalMessage();
        }
        return Objects.requireNonNullElse(exception.getMessage(), "Invalid JSON");
    }

    private static Map<String, Object> error(
            String type,
            List<Object> loc,
            String message,
            Object input) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("type", type);
        value.put("loc", loc);
        value.put("msg", message);
        value.put("input", input);
        return value;
    }

    /** 요청 트리 선검증도 advice 와 정확히 같은 pydantic 오류 형상을 사용한다. */
    static Map<String, Object> validationError(
            String type,
            List<Object> loc,
            String message,
            Object input) {
        return error(type, loc, message, input);
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String detail) {
        return ResponseEntity.status(status).body(Map.of("detail", detail));
    }

    private record ResolvedPath(List<Object> loc, List<Integer> order) {
    }

    private record ResolvedFieldError(FieldError error, ResolvedPath path) {
    }
}
