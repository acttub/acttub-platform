package com.acttub.actingapi.feature.consent.adapter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

import com.acttub.actingapi.feature.consent.app.ReconsentSchedule;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

/** manifest 의 {@code reconsentFrom} 을 요청마다 읽는다(고지 문서와 같은 이유: 파일이 작고 DB 에 둘 열이 없다). */
@Component
class DeployedReconsentSchedule implements ReconsentSchedule {
    private record Item(String type, String version, String locale, String reconsentFrom) {
    }

    private final ObjectMapper mapper;
    private final ResourceLoader resources;
    private final String configuredDir;

    DeployedReconsentSchedule(
            ObjectMapper mapper,
            ResourceLoader resources,
            @Value("${CONSENT_DOCS_DIR:}") String configuredDir) {
        this.mapper = mapper.copy().configure(
                com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.resources = resources;
        this.configuredDir = configuredDir;
    }

    @Override
    public Instant reconsentFrom(String type, String version) {
        Resource manifest = configuredDir != null && !configuredDir.isBlank()
                ? new FileSystemResource(Path.of(configuredDir).resolve("manifest.json"))
                : resources.getResource("classpath:consent-docs/manifest.json");
        List<Item> items;
        try (var in = manifest.getInputStream()) {
            items = mapper.readValue(in, new TypeReference<>() { });
        } catch (IOException unreadable) {
            // 일정을 못 읽으면 미루지 않는다 — 재동의를 빠뜨리는 쪽이 더 나쁘다.
            throw new UncheckedIOException("consent manifest is unreadable", unreadable);
        }
        return items.stream()
                .filter(item -> type.equals(item.type()) && version.equals(item.version())
                        && item.reconsentFrom() != null && !item.reconsentFrom().isBlank())
                .map(item -> OffsetDateTime.parse(item.reconsentFrom()).toInstant())
                .findFirst()
                .orElse(null);
    }
}
