package com.acttub.actingapi.platform.observability;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.LongTaskTimer;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.stereotype.Component;

/** Tracks the server request, including authentication, database waits and response serialization. */
@Component
public class HttpRequestMetrics implements ObservationHandler<ServerRequestObservationContext> {
    private final Map<String, LongTaskTimer> timers;
    private final Map<String, Counter> completed;

    public HttpRequestMetrics(MeterRegistry registry) {
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
        // These four POST paths have no variable segments; unrecognized paths never become labels.
        LongTaskTimer timer = timers.get(request.getServletPath());
        if (timer != null) context.put(HttpRequestMetrics.class, timer.start());
    }

    @Override
    public void onStop(ServerRequestObservationContext context) {
        if (context.remove(HttpRequestMetrics.class) instanceof LongTaskTimer.Sample sample) sample.stop();
        int status = context.getResponse() == null ? 0 : context.getResponse().getStatus();
        String statusClass = status >= 100 && status < 600 ? status / 100 + "xx" : "other";
        completed.get(statusClass + ":" + HttpMonitoringConfiguration.latencyClass(context)).increment();
    }
}
