package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.CloudVoiceStorage;
import com.acttub.actingapi.feature.reading.app.VoiceSynthesizer;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "GEMINI_TTS_MODEL=test-tts-model"})
@AutoConfigureMockMvc
@Import(CloudVoiceIT.Fakes.class)
class CloudVoiceIT {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("cloud_voice");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
        registry.add("GEMINI_API_KEY", () -> "test-key-not-real");
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper mapper;
    String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention", "cloud_voice")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, UUID.randomUUID(), type, type, type, !List.of("retention", "cloud_voice").contains(type),
                    OffsetDateTime.of(2026, 9, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        }
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
    }

    @Test
    void statusHasContractShape() throws Exception {
        var response = mvc.perform(get("/v2/reading/voice/status").header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "available", "free_until", "consent", "daily_limit", "daily_used");
        assertThat(body.path("available").booleanValue()).isTrue();
        assertThat(body.path("consent").textValue()).isEqualTo("granted");
        assertThat(body.path("daily_limit").intValue()).isEqualTo(300);
        assertThat(body.path("daily_used").intValue()).isZero();
    }

    @Test
    void statusRequiresAuthentication() throws Exception {
        var response = mvc.perform(get("/v2/reading/voice/status")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fakes {
        @Bean @Primary VoiceSynthesizer fakeVoiceSynthesizer() { return (text, voice) -> new byte[] {1, 2}; }
        @Bean @Primary CloudVoiceStorage fakeCloudVoiceStorage() {
            return new CloudVoiceStorage() {
                public boolean configured() { return true; }
                public void upload(String key, byte[] wav) {}
                public String playbackUrl(String key, int expiresInSeconds) { return "https://example.test/voice.wav"; }
            };
        }
    }
}
