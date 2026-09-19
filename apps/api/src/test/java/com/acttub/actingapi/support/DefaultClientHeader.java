package com.acttub.actingapi.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.stereotype.Component;
import org.springframework.test.web.servlet.setup.ConfigurableMockMvcBuilder;

/**
 * 테스트의 MockMvc 요청에 클라이언트 판 헤더를 기본으로 싣는다.
 *
 * <p>{@code /v2} 는 {@code X-Acttub-Client} 가 없으면 무엇을 부르든 426 이다(모든 판정보다 먼저다).
 * 그 규칙을 보는 테스트는 하나면 되고, 나머지 수백 개가 요청마다 같은 헤더를 적으면 정작 보려는
 * 것이 묻힌다. 그래서 1.0.0 앱이 하듯 기본으로 싣는다.
 *
 * <p>{@code @TestConfiguration} 이 아니라 {@code @Component} 인 것은 의도한 것이다 — 컴포넌트
 * 스캔에 걸려 {@code @AutoConfigureMockMvc} 를 쓰는 모든 테스트에 저절로 붙는다. 헤더가 <b>없는</b>
 * 요청을 봐야 하는 테스트는 {@code acttub.test.default-client-header=false} 로 끈다.
 */
@Component
public class DefaultClientHeader implements MockMvcBuilderCustomizer {

    public static final String NAME = "X-Acttub-Client";
    public static final String APP = "app/1.0.0";

    private final boolean enabled;

    DefaultClientHeader(@Value("${acttub.test.default-client-header:true}") boolean enabled) {
        this.enabled = enabled;
    }

    @Override
    public void customize(ConfigurableMockMvcBuilder<?> builder) {
        if (enabled) {
            builder.defaultRequest(get("/").header(NAME, APP));
        }
    }
}
