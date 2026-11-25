package com.acttub.actingapi.platform.observability;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.LongTaskTimer;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.stereotype.Component;

/**
 * Tracks the server request, including authentication, database waits and response serialization.
 *
 * <p>요청 수를 클라이언트 버전별로도 센다({@code acttub.http.requests.by.client}). 버전은 {@link ClientLabel} 로 줄인 값이고,
 * 경로·메서드·상태는 {@code http.server.requests} 와 같은 값(매핑 템플릿 또는 {@code NOT_FOUND}·{@code UNKNOWN})이다.
 * 426 으로 막힌 요청도 여기서 센다.
 *
 * <p><b>{@code client} 값은 프로세스가 사는 동안 {@value #CLIENT_LIMIT} 가지까지만 제 이름으로 센다.</b> 헤더는 로그인 없이
 * 누구나 보내고 {@link ClientLabel} 의 허용 꼴도 수조 가지라, 받은 값마다 카운터를 만들면 버전 숫자만 바꾼 요청으로 카운터가
 * 끝없이 늘고 지워지지 않는다. 처음 본 순서로 상한까지 받고, 그 뒤의 새 값은 {@code other} 로 센다({@code none}·{@code other}
 * 는 자리를 쓰지 않는다). 상한은 헤더를 싣는 실제 버전 수(2026-11 기준 앱 0.1.0~1.1.3 의 열두 가지와 웹 하나)의 두 배 남짓이다.
 * 요청 로그의 {@code client} 칸은 이 상한 없이 실제 값을 남긴다.
 */
@Component
public class HttpRequestMetrics implements ObservationHandler<ServerRequestObservationContext> {
    static final int CLIENT_LIMIT = 32;

    private static final DefaultServerRequestObservationConvention LABELS = new DefaultServerRequestObservationConvention();

    private final MeterRegistry registry;
    private final Map<String, LongTaskTimer> timers;
    private final Map<String, Counter> completed;
    private final Set<String> clients = ConcurrentHashMap.newKeySet();

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
                "client", client(context.getCarrier()),
                "method", value(labels, "method"),
                "uri", value(labels, "uri"),
                "status", value(labels, "status")).increment();
    }

    /** 상한 안에서 처음 보거나 이미 받은 값은 그대로, 상한이 찬 뒤의 새 값은 {@code other}. 자리는 잠근 채로만 늘어 동시 요청에도 넘지 않는다. */
    private String client(HttpServletRequest request) {
        String client = ClientLabel.of(request);
        if (client.equals(ClientLabel.NONE) || client.equals(ClientLabel.OTHER) || clients.contains(client)) return client;
        synchronized (clients) {
            if (clients.size() < CLIENT_LIMIT) {
                clients.add(client);
                return client;
            }
            return clients.contains(client) ? client : ClientLabel.OTHER;
        }
    }

    private static String value(KeyValues labels, String key) {
        return labels.stream().filter(label -> label.getKey().equals(key)).findFirst()
                .map(KeyValue::getValue).orElse("UNKNOWN");
    }
}
