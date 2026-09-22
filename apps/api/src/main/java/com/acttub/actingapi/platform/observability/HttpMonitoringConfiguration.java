package com.acttub.actingapi.platform.observability;

import java.util.Map;

import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.ObservationPredicate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.autoconfigure.metrics.MeterRegistryCustomizer;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.http.server.observation.ServerRequestObservationConvention;

@Configuration(proxyBeanMethods = false)
public class HttpMonitoringConfiguration {
    static final Map<String, String> ACTIVE_POST_ROUTES = Map.of(
            "/v2/coach/start", "coach", "/v2/coach/reply", "coach");

    static String latencyClass(ServerRequestObservationContext context) {
        String route = context.getPathPattern();
        boolean longRunning = "POST".equals(context.getCarrier().getMethod()) && route != null
                && (ACTIVE_POST_ROUTES.containsKey(route)
                // 1.0.0 의 회차 시작·재시도도 분석을 거는 자리다 — 옛 `/v2/practice-sessions/**` 는 내렸다(§6-15).
                || route.equals("/v2/practices")
                || route.equals("/v2/practices/{practice_id}/analyze"));
        return longRunning ? "long_running" : "ordinary";
    }

    @Bean
    MeterRegistryCustomizer<MeterRegistry> monitoringLabels(
            @Value("${MONITORING_ENVIRONMENT:local}") String environment) {
        String safeEnvironment = switch (environment) {
            case "dev", "prod" -> environment;
            default -> "local";
        };
        return registry -> registry.config().commonTags("environment", safeEnvironment, "service", "acting-api");
    }

    @Bean
    ServerRequestObservationConvention httpRequestConvention() {
        return new DefaultServerRequestObservationConvention() {
            @Override
            public KeyValues getLowCardinalityKeyValues(ServerRequestObservationContext context) {
                // Spring's convention uses the MVC template, NOT_FOUND or UNKNOWN, never an unmatched raw URL.
                return super.getLowCardinalityKeyValues(context)
                        .and(KeyValue.of("latency_class", latencyClass(context)));
            }

            @Override
            public KeyValues getHighCardinalityKeyValues(ServerRequestObservationContext context) {
                return KeyValues.empty();
            }
        };
    }

    @Bean
    ObservationPredicate excludeMonitoringRequests(ApplicationContext application) {
        return (name, context) -> {
            if (!(context instanceof ServerRequestObservationContext requestContext)) return true;
            var request = requestContext.getCarrier();
            String path = request.getServletPath();
            if (path.equals("/health") || path.equals("/actuator") || path.startsWith("/actuator/")) return false;
            return !(application instanceof ServletWebServerApplicationContext web)
                    || web.getWebServer() == null || request.getLocalPort() == web.getWebServer().getPort();
        };
    }
}
