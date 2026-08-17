package com.acttub.actingapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * 동의 게이트가 바디 검증보다 먼저 도는지 확인한다.
 *
 * <p>등록이 {@code web}과 {@code auth} 두 {@code WebMvcConfigurer}로 갈라져 있어(ADR-016),
 * 순서는 이제 <b>한 파일을 읽어서는 알 수 없다.</b> {@code web.InterceptorOrder}가 값을 소유하지만
 * 상수만으로는 실제 체인이 그 순서로 조립됐음을 보장하지 못한다 — 그 간극을 이 테스트가 메운다.
 *
 * <p>순서가 뒤집히면 미동의 사용자의 요청 바디를 먼저 검증하게 되어, 403이어야 할 요청이 422로
 * 나간다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class InterceptorOrderIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("interceptor_order");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    RequestMappingHandlerMapping handlerMapping;

    @Test
    void consentGateRunsBeforeBodyValidation() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/reports");
        HandlerExecutionChain chain = handlerMapping.getHandler(request);

        assertThat(chain).as("POST /v2/reports 핸들러가 잡혀야 한다").isNotNull();
        List<String> names = Arrays.stream(chain.getInterceptors())
                .map(interceptor -> interceptor.getClass().getSimpleName())
                .toList();

        assertThat(names).contains("ConsentGateInterceptor", "RequestBodyValidationInterceptor");
        assertThat(names.indexOf("ConsentGateInterceptor"))
                .as("동의 게이트가 바디 검증보다 앞이어야 한다: %s", names)
                .isLessThan(names.indexOf("RequestBodyValidationInterceptor"));
    }
}
