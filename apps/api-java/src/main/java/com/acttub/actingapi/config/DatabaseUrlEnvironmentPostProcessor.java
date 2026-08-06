package com.acttub.actingapi.config;

import java.util.HashMap;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * {@code DATABASE_URL} 을 읽어 {@code spring.datasource.*} 를 채운다.
 *
 * <p>DataSource 자동설정보다 먼저 돌아야 하므로 {@code @Configuration} 이 아니라
 * {@link EnvironmentPostProcessor} 다. 등록은
 * {@code META-INF/spring/org.springframework.boot.env.EnvironmentPostProcessor.imports}.
 *
 * <p>{@code spring.datasource.url} 이 이미 명시돼 있으면 건드리지 않는다 —
 * 테스트(Testcontainers)가 직접 지정하는 경우를 위해서다.
 */
public class DatabaseUrlEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    static final String PROPERTY_SOURCE_NAME = "acttubDatabaseUrl";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (environment.containsProperty("spring.datasource.url")) {
            return;
        }
        String raw = environment.getProperty("DATABASE_URL");
        if (raw == null || raw.isBlank()) {
            return;
        }
        DatabaseUrl parsed = DatabaseUrl.parse(raw);
        Map<String, Object> props = new HashMap<>();
        props.put("spring.datasource.url", parsed.jdbcUrl());
        if (parsed.username() != null) {
            props.put("spring.datasource.username", parsed.username());
        }
        if (parsed.password() != null) {
            props.put("spring.datasource.password", parsed.password());
        }
        environment.getPropertySources()
                .addFirst(new MapPropertySource(PROPERTY_SOURCE_NAME, props));
    }

    @Override
    public int getOrder() {
        // ConfigDataEnvironmentPostProcessor(=application.yml 로딩) 이후에 돈다.
        return Ordered.LOWEST_PRECEDENCE;
    }
}
