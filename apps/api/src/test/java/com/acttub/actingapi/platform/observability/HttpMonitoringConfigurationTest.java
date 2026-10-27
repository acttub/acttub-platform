package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class HttpMonitoringConfigurationTest {

    private static String classify(String method, String route) {
        var context = new ServerRequestObservationContext(
                new MockHttpServletRequest(method, route), new MockHttpServletResponse());
        context.setPathPattern(route);
        return HttpMonitoringConfiguration.latencyClass(context);
    }

    @Test
    void aiGenerationPostsAreLongRunning() {
        assertThat(classify("POST", "/v2/reading/voice")).isEqualTo("long_running");
        assertThat(classify("POST", "/v2/sample-scripts")).isEqualTo("long_running");
        assertThat(classify("POST", "/v2/sample-scripts/{sample_script_id}/revisions")).isEqualTo("long_running");
        assertThat(classify("POST", "/v2/coach/start/stream")).isEqualTo("long_running");
    }

    @Test
    void quickRoutesStayOrdinary() {
        assertThat(classify("GET", "/v2/reading/voice/status")).isEqualTo("ordinary");
        assertThat(classify("GET", "/v2/sample-scripts/{sample_script_id}")).isEqualTo("ordinary");
        assertThat(classify("POST", "/v2/sample-scripts/{sample_script_id}/save")).isEqualTo("ordinary");
        assertThat(classify("POST", "/v2/sample-scripts/{sample_script_id}/restore")).isEqualTo("ordinary");
        assertThat(classify("GET", "/v2/admin/ops-core")).isEqualTo("ordinary");
        assertThat(classify("GET", "/v2/me/notifications/unread-count")).isEqualTo("ordinary");
    }
}
