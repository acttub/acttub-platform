package com.acttub.actingapi.health;

import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression("T(org.springframework.util.StringUtils).hasText('${KEEP_ALIVE_URL:}')")
class KeepAliveConfiguration {

    @Bean("keepAliveIntervalMillis")
    Long keepAliveIntervalMillis(
            @Value("${KEEP_ALIVE_INTERVAL_SEC:600}") long intervalSeconds) {
        if (intervalSeconds <= 0) {
            throw new IllegalStateException("KEEP_ALIVE_INTERVAL_SEC must be positive");
        }
        return Math.multiplyExact(intervalSeconds, 1000L);
    }

    @Bean
    KeepAlivePinger keepAlivePinger(
            @Value("${KEEP_ALIVE_URL}") String url) {
        Duration timeout = Duration.ofSeconds(30);
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(timeout).build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(timeout);
        RestClient client = RestClient.builder().requestFactory(requestFactory).build();
        return new KeepAlivePinger(url, target -> client.get().uri(target).retrieve().toBodilessEntity());
    }
}
