package com.acttub.actingapi.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * DTO 검증 인터셉터를 건다.
 *
 * <p>동의 게이트는 {@code auth}가 직접 등록한다({@code AuthWebMvcConfiguration}). 실행 순서는
 * {@link InterceptorOrder}에 모여 있다.
 */
@Configuration(proxyBeanMethods = false)
class WebMvcConfiguration implements WebMvcConfigurer {
    private final RequestBodyValidationInterceptor bodyValidation;

    WebMvcConfiguration(RequestBodyValidationInterceptor bodyValidation) {
        this.bodyValidation = bodyValidation;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(bodyValidation).order(InterceptorOrder.BODY_VALIDATION);
    }
}
