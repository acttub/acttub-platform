package com.acttub.actingapi.feature.appconfig.adapter;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.appconfig.app.AppConfig;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 앱 설정(SOMA-939)의 조립. 기동할 때 한 번 읽는다 — 값을 바꾸면 api 를 다시 띄운다.
 *
 * <p>기본 파일(resources {@code app-config/defaults.json}) 위에 {@code APP_CONFIG_FILE}(서버의 JSON 파일 경로, 없으면 기본만)을
 * 칸 단위로 덮는다. 덮을 파일을 못 읽거나 모양이 틀리면 기본값으로 서고 경고만 남긴다 — 설정 실수로 api 가 안 뜨면 안 된다.
 */
@Configuration
class AppConfigConfiguration {
    private static final Logger log = LoggerFactory.getLogger(AppConfigConfiguration.class);
    static final String DEFAULTS = "app-config/defaults.json";

    /** 서버가 이미 막는 규칙. 각 도메인 규칙(LineMatch·ChallengeRules·CocreateRules)과 같은지는 AppConfigEndpointIT 가 잠근다. */
    static final AppConfig.ServerRules RULES = new AppConfig.ServerRules(0.72, 60, List.of(7, 14),
            List.of("설렘", "분노", "슬픔", "긴장", "서운함", "담담함"));

    @Bean
    AppConfig appConfig(@Value("${APP_CONFIG_FILE:}") String overrideFile) throws IOException {
        ObjectMapper mapper = new ObjectMapper()
                .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        JsonNode defaultsNode;
        try (InputStream in = AppConfigConfiguration.class.getClassLoader().getResourceAsStream(DEFAULTS)) {
            if (in == null) throw new IOException("missing " + DEFAULTS);
            defaultsNode = mapper.readTree(in);
        }
        AppConfig defaults = mapper.treeToValue(defaultsNode, AppConfig.class);
        AppConfig merged = defaults;
        if (overrideFile != null && !overrideFile.isBlank()) {
            try {
                JsonNode override = mapper.readTree(Files.readString(Path.of(overrideFile)));
                merged = mapper.treeToValue(merge(defaultsNode.deepCopy(), override), AppConfig.class);
            } catch (IOException | IllegalArgumentException e) {
                log.warn("app_config_override_ignored file={} reason={}", overrideFile, e.getMessage());
            }
        }
        return AppConfig.validated(merged, defaults, RULES);
    }

    /** 객체는 칸마다 합치고, 그 밖(숫자·글·목록)은 덮을 쪽 값으로 바꾼다. */
    static JsonNode merge(JsonNode base, JsonNode override) {
        if (!(base instanceof ObjectNode target) || override == null || !override.isObject()) return override;
        for (Iterator<Map.Entry<String, JsonNode>> it = override.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> field = it.next();
            JsonNode current = target.get(field.getKey());
            target.set(field.getKey(), current != null && current.isObject() ? merge(current, field.getValue()) : field.getValue());
        }
        return target;
    }
}
