package com.acttub.actingapi.web;

import com.acttub.actingapi.auth.ConsentGateInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 요청 정책 게이트와 DTO 검증의 실행 순서를 고정한다. */
@Configuration(proxyBeanMethods = false)
class WebMvcConfiguration implements WebMvcConfigurer {
    private final ConsentGateInterceptor consentGate;
    private final RequestBodyValidationInterceptor bodyValidation;

    WebMvcConfiguration(
            ConsentGateInterceptor consentGate,
            RequestBodyValidationInterceptor bodyValidation) {
        this.consentGate = consentGate;
        this.bodyValidation = bodyValidation;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(consentGate).order(0);
        registry.addInterceptor(bodyValidation).order(1);
    }
}
