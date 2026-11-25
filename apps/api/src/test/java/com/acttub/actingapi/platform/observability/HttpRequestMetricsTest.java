package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.platform.security.ClientVersionFilter;
import io.micrometer.prometheusmetrics.PrometheusConfig;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 클라이언트 버전별 요청 수의 {@code client} 값 종류에 상한이 있다. 헤더는 누구나 보내므로 버전 숫자만 바꾼 요청이 카운터를 끝없이
 * 늘리지 못해야 한다. 수집 결과는 관리 포트가 내주는 것과 같은 Prometheus 글({@link PrometheusMeterRegistry#scrape()})로 본다.
 *
 * <p>실제 부팅 시험({@code HttpMonitoringIT})에서 상한을 채우지 않는 까닭: 같은 Spring 컨텍스트를 다른 시험이 함께 쓰므로 자리를
 * 채우면 그 뒤에 도는 시험의 {@code client} 값이 순서에 따라 {@code other} 로 바뀐다.
 */
class HttpRequestMetricsTest {

    private static final Pattern LINE = Pattern.compile("^acttub_http_requests_by_client_total\\{.*client=\"([^\"]*)\".*} (\\S+)$");

    @Test
    void clientValuesStopAtTheLimitAndNewOnesAreCountedAsOtherEvenWhenRequestsRace() throws Exception {
        int limit = HttpRequestMetrics.CLIENT_LIMIT;
        int racers = 16;
        int repeats = 3;
        ExecutorService pool = Executors.newFixedThreadPool(racers);
        try {
            // 마지막 자리를 두고 다투는 순간을 여러 번 만든다.
            for (int round = 0; round < 100; round++) {
                PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
                HttpRequestMetrics metrics = new HttpRequestMetrics(registry);
                for (int i = 0; i < limit - 1; i++) metrics.onStop(context("web/0." + i));
                metrics.onStop(context(null));
                metrics.onStop(context("evil/1.0.0"));

                // 자리가 하나 남았을 때 서로 다른 허용 꼴 버전들이 모두 돌고 있는 스레드에서 같은 순간에 출발한다.
                CountDownLatch ready = new CountDownLatch(racers);
                AtomicBoolean go = new AtomicBoolean();
                List<Future<?>> done = new ArrayList<>();
                for (int i = 0; i < racers; i++) {
                    List<ServerRequestObservationContext> requests = new ArrayList<>();
                    for (int n = 0; n < repeats; n++) requests.add(context("app/1." + round + "." + i));
                    done.add(pool.submit(() -> {
                        ready.countDown();
                        while (!go.get()) Thread.onSpinWait();
                        requests.forEach(metrics::onStop);
                        return null;
                    }));
                }
                ready.await();
                go.set(true);
                for (Future<?> request : done) request.get();

                Map<String, Double> byClient = countsByClient(registry.scrape());
                assertThat(byClient.keySet().stream().filter(client -> client.startsWith("app/")))
                        .as("남은 한 자리만 채워진다").hasSize(1);
                assertThat(byClient).as("상한 + other·none").hasSize(limit + 2);
                // 받은 버전은 요청이 모두 제 이름으로, 못 받은 버전은 모두 other 로 세어진다 — 한 버전이 둘로 갈리지 않는다.
                byClient.forEach((client, count) -> {
                    if (client.startsWith("app/")) assertThat(count).as(client).isEqualTo(repeats);
                });
                assertThat(byClient.get(ClientLabel.OTHER)).isEqualTo((racers - 1) * repeats + 1);
                assertThat(byClient.get(ClientLabel.NONE)).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void valuesAlreadyAcceptedKeepTheirNameAfterTheLimitIsReached() {
        PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        HttpRequestMetrics metrics = new HttpRequestMetrics(registry);
        metrics.onStop(context("app/1.1.3"));
        for (int i = 0; i < HttpRequestMetrics.CLIENT_LIMIT + 5; i++) metrics.onStop(context("web/9." + i));

        metrics.onStop(context("app/1.1.3"));
        metrics.onStop(context("app/1.1.4"));

        Map<String, Double> byClient = countsByClient(registry.scrape());
        assertThat(byClient.get("app/1.1.3")).isEqualTo(2);
        assertThat(byClient).doesNotContainKey("app/1.1.4");
        assertThat(byClient.get(ClientLabel.OTHER)).isEqualTo(6 + 1);
        assertThat(byClient).hasSize(HttpRequestMetrics.CLIENT_LIMIT + 1);
    }

    private static ServerRequestObservationContext context(String header) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/me");
        if (header != null) request.addHeader(ClientVersionFilter.HEADER, header);
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setStatus(200);
        var context = new ServerRequestObservationContext(request, response);
        context.setPathPattern("/v2/me");
        return context;
    }

    private static Map<String, Double> countsByClient(String scrape) {
        Map<String, Double> counts = new TreeMap<>();
        for (String line : scrape.split("\n")) {
            Matcher matcher = LINE.matcher(line);
            if (matcher.matches()) counts.merge(matcher.group(1), Double.parseDouble(matcher.group(2)), Double::sum);
        }
        return counts;
    }
}
