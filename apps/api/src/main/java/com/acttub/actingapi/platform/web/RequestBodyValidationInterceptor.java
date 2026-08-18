package com.acttub.actingapi.platform.web;

import java.nio.charset.StandardCharsets;

import com.acttub.actingapi.platform.web.RequestBodyCachingFilter.CachedBodyRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.util.WebUtils;

/** 캐시된 JSON 트리를 DTO로 바인딩하기 전에 검증해 필드 오류를 전량 누적한다. */
@Component
final class RequestBodyValidationInterceptor implements HandlerInterceptor {
    private final ObjectMapper mapper;
    private final RequestBodyTreeValidator validator;

    RequestBodyValidationInterceptor(ObjectMapper mapper, RequestBodyTreeValidator validator) {
        this.mapper = mapper;
        this.validator = validator;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        MethodParameter bodyParameter = requestBodyParameter(method);
        if (bodyParameter == null || !bodyParameter.getParameterType().isRecord()) {
            return true;
        }

        CachedBodyRequest cached = WebUtils.getNativeRequest(request, CachedBodyRequest.class);
        if (cached == null || cached.body().length == 0) {
            return true;
        }
        JsonNode tree;
        try {
            tree = mapper.readTree(new String(cached.body(), StandardCharsets.UTF_8));
        } catch (JsonProcessingException ignored) {
            // JSON 파싱 오류의 byte offset·ctx 형상은 기존 advice/Jackson 경로가 정본이다.
            return true;
        }
        if (tree == null || !tree.isObject()) {
            return true;
        }

        var errors = validator.validate(bodyParameter.getParameterType(), tree);
        if (!errors.isEmpty()) {
            throw new ApiValidationException(errors);
        }
        return true;
    }

    private static MethodParameter requestBodyParameter(HandlerMethod method) {
        for (MethodParameter parameter : method.getMethodParameters()) {
            if (parameter.hasParameterAnnotation(RequestBody.class)) {
                return parameter;
            }
        }
        return null;
    }
}
