package com.acttub.actingapi.security;

import com.acttub.actingapi.web.InterceptorOrder;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 동의 게이트를 인터셉터 체인에 건다.
 *
 * <p>등록이 {@code web}이 아니라 여기 있는 이유는 방향이다 — {@code web}이 이 인터셉터를
 * 알면 {@code security → web}(예외 타입 참조)과 맞물려 순환이 된다 (ADR-016). 순서 값은
 * {@link InterceptorOrder}가 소유한다.
 */
@Configuration(proxyBeanMethods = false)
class SecurityWebMvcConfiguration implements WebMvcConfigurer {
    private final ConsentGateInterceptor consentGate;

    SecurityWebMvcConfiguration(ConsentGateInterceptor consentGate) {
        this.consentGate = consentGate;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(consentGate).order(InterceptorOrder.CONSENT_GATE);
    }
}
