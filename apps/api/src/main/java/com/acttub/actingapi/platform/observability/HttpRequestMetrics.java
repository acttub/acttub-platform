package com.acttub.actingapi.platform.observability;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.LongTaskTimer;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.stereotype.Component;

/**
 * Tracks the server request, including authentication, database waits and response serialization.
 *
 * <p>요청 수를 클라이언트 판별로도 센다({@code acttub.http.requests.by.client}). 판은 {@link ClientLabel} 로 줄인 값이고,
 * 경로·메서드·상태는 {@code http.server.requests} 와 같은 값(매핑 템플릿 또는 {@code NOT_FOUND}·{@code UNKNOWN})이다.
 * 426 으로 막힌 요청도 여기서 센다.
 */
@Component
public class HttpRequestMetrics implements ObservationHandler<ServerRequestObservationContext> {
    private static final DefaultServerRequestObservationConvention LABELS = new DefaultServerRequestObservationConvention();

    private final MeterRegistry registry;
    private final Map<String, LongTaskTimer> timers;
    private final Map<String, Counter> completed;

    public HttpRequestMetrics(MeterRegistry registry) {
        this.registry = registry;
        Map<String, LongTaskTimer> active = new HashMap<>();
        HttpMonitoringConfiguration.ACTIVE_POST_ROUTES.forEach(
                (route, feature) -> active.put(route, timer(registry, feature, route)));
        timers = Map.copyOf(active);
        Map<String, Counter> counters = new HashMap<>();
        // All twelve series exist before the first request, so the first error
        // burst has a zero sample even when its detailed route/status is new.
        for (String status : List.of("1xx", "2xx", "3xx", "4xx", "5xx", "other")) {
            for (String latency : List.of("ordinary", "long_running")) {
                counters.put(status + ":" + latency, Counter.builder("acttub.http.requests")
                        .tags("status_class", status, "latency_class", latency).register(registry));
            }
        }
        completed = Map.copyOf(counters);
    }

    private static LongTaskTimer timer(MeterRegistry registry, String feature, String route) {
        return LongTaskTimer.builder("acttub.http.active")
                .description("Currently active server HTTP requests and their elapsed duration")
                .tags("feature", feature, "route", route).register(registry);
    }

    @Override
    public boolean supportsContext(Observation.Context context) {
        return context instanceof ServerRequestObservationContext;
    }

    @Override
    public void onStart(ServerRequestObservationContext context) {
        var request = context.getCarrier();
        if (!request.getMethod().equals("POST")) return;
        // These POST paths have no variable segments; unrecognized paths never become labels.
        LongTaskTimer timer = timers.get(request.getServletPath());
        if (timer != null) context.put(HttpRequestMetrics.class, timer.start());
    }

    @Override
    public void onStop(ServerRequestObservationContext context) {
        if (context.remove(HttpRequestMetrics.class) instanceof LongTaskTimer.Sample sample) sample.stop();
        int status = context.getResponse() == null ? 0 : context.getResponse().getStatus();
        String statusClass = status >= 100 && status < 600 ? status / 100 + "xx" : "other";
        completed.get(statusClass + ":" + HttpMonitoringConfiguration.latencyClass(context)).increment();
        KeyValues labels = LABELS.getLowCardinalityKeyValues(context);
        registry.counter("acttub.http.requests.by.client",
                "client", ClientLabel.of(context.getCarrier()),
                "method", value(labels, "method"),
                "uri", value(labels, "uri"),
                "status", value(labels, "status")).increment();
    }

    private static String value(KeyValues labels, String key) {
        return labels.stream().filter(label -> label.getKey().equals(key)).findFirst()
                .map(KeyValue::getValue).orElse("UNKNOWN");
    }
}
