package com.acttub.actingapi.platform.harness;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ContractClientHostFilterTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(ContractClientHostFilter.class);

    @Test
    void trustedClientHostBoundaryExistsOnlyInContractProfile() {
        runner.run(context -> assertThat(context)
                .doesNotHaveBean(ContractClientHostFilter.class));
        runner.withPropertyValues("spring.profiles.active=contract")
                .run(context -> assertThat(context)
                        .hasSingleBean(ContractClientHostFilter.class));
    }

    @Test
    void headerOverridesOnlyApplicationRequestRemoteAddress() throws Exception {
        var filter = new ContractClientHostFilter();
        var request = new MockHttpServletRequest("POST", "/v2/auth/login");
        request.setRemoteAddr("127.0.0.1");
        request.addHeader(ContractClientHostFilter.HEADER, "10.0.0.9");
        var chain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertThat(chain.getRequest().getRemoteAddr()).isEqualTo("10.0.0.9");

        var control = new MockHttpServletRequest("POST", "/__harness/reset-state");
        control.setRemoteAddr("127.0.0.1");
        control.addHeader(ContractClientHostFilter.HEADER, "203.0.113.10");
        var controlChain = new MockFilterChain();
        filter.doFilter(control, new MockHttpServletResponse(), controlChain);
        assertThat(controlChain.getRequest().getRemoteAddr()).isEqualTo("127.0.0.1");
    }
}
