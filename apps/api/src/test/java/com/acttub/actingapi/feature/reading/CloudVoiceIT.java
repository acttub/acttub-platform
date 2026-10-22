package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.CloudVoiceStorage;
import com.acttub.actingapi.feature.reading.app.VoiceModelStorage;
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
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "GEMINI_TTS_MODEL=test-tts-model",
        "READING_VOICE_MODEL_PREFIX=reading-model/supertonic3-fp16-v1"})
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
    UUID user;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents,reading_voice_cache RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention", "cloud_voice")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, UUID.randomUUID(), type, type, type, !List.of("retention", "cloud_voice").contains(type),
                    OffsetDateTime.of(2026, 9, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        }
        user = UUID.randomUUID();
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
    void voiceModelListsSignedFiles() throws Exception {
        var response = mvc.perform(get("/v2/reading/voice-model").header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("version", "files", "expires_in");
        assertThat(body.path("version").textValue()).isEqualTo("supertonic3-fp16-v1");
        assertThat(body.path("expires_in").intValue()).isEqualTo(3600);
        assertThat(body.path("files")).hasSize(8);
        JsonNode first = body.path("files").get(0);
        assertThat(first.fieldNames()).toIterable().containsExactlyInAnyOrder("name", "bytes", "sha256", "url");
        assertThat(first.path("url").textValue())
                .isEqualTo("https://example.test/reading-model/supertonic3-fp16-v1/duration_predictor.graph.onnx");
    }

    @Test
    void voiceModelRequiresAuthentication() throws Exception {
        assertThat(mvc.perform(get("/v2/reading/voice-model")).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void statusRequiresAuthentication() throws Exception {
        var response = mvc.perform(get("/v2/reading/voice/status")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    private org.springframework.mock.web.MockHttpServletResponse synthesize(String body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v2/reading/voice")
                .header("Authorization", bearer).contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
    }

    private String consent() throws Exception {
        var response = mvc.perform(get("/v2/reading/voice/status").header("Authorization", bearer)).andReturn().getResponse();
        return mapper.readTree(response.getContentAsString()).path("consent").textValue();
    }

    @Test
    void reading_cloudVoice_aLineIsSynthesizedOnceThenServedFromTheCache() throws Exception {
        var first = synthesize("{\"text\":\" 가지 마. \",\"voice\":\"F1\"}");
        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(first.getContentAsString()).path("audio_url").textValue()).isEqualTo("https://example.test/voice.wav");
        assertThat(mapper.readTree(first.getContentAsString()).path("cached").booleanValue()).isFalse();
        var again = synthesize("{\"text\":\"가지 마.\",\"voice\":\"F1\"}");
        assertThat(mapper.readTree(again.getContentAsString()).path("cached").booleanValue()).isTrue();
        var status = mvc.perform(get("/v2/reading/voice/status").header("Authorization", bearer)).andReturn().getResponse();
        assertThat(mapper.readTree(status.getContentAsString()).path("daily_used").intValue()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_voice_cache", Long.class)).isEqualTo(1L);
    }

    @Test
    void reading_cloudVoice_aLineOverFiveHundredCharsIsSynthesizedNotRejected() throws Exception {
        var response = synthesize("{\"text\":\"" + ("가".repeat(299) + ". ").repeat(2) + "\",\"voice\":\"F1\"}");
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString()).path("cached").booleanValue()).isFalse();
    }

    @Test
    void reading_cloudVoice_emptyTooLongOrUnknownVoiceRequestsAreInvalid() throws Exception {
        for (String body : List.of("{\"text\":\"  \",\"voice\":\"F1\"}", "{\"text\":\"" + "가".repeat(5001) + "\",\"voice\":\"F1\"}",
                "{\"text\":\"가지 마\",\"voice\":\"X9\"}")) {
            var response = synthesize(body);
            assertThat(response.getStatus()).as(body).isEqualTo(400);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue()).isEqualTo("invalid_voice_request");
        }
    }

    @Test
    void reading_cloudVoice_aRequestWithoutVoiceIsInvalid() throws Exception {
        for (String body : List.of("{}", "{\"text\":\"가지 마\"}")) {
            var response = synthesize(body);
            assertThat(response.getStatus()).as(body).isEqualTo(400);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue()).isEqualTo("invalid_voice_request");
        }
    }

    @Test
    void reading_cloudVoice_withdrawnOrUndecidedConsentBlocksSynthesisUntilPrivacyV9Covers() throws Exception {
        UUID document = jdbc.queryForObject("SELECT id FROM consent_documents WHERE type='cloud_voice'", UUID.class);
        jdbc.update("INSERT INTO user_consents(id,user_id,document_id,action,occurred_at) VALUES (?,?,?,'revoked',now() + interval '1 second')",
                UUID.randomUUID(), user, document);
        assertThat(consent()).isEqualTo("denied");
        var denied = synthesize("{\"text\":\"가지 마\",\"voice\":\"F1\"}");
        assertThat(denied.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(denied.getContentAsString()).path("detail").textValue()).isEqualTo("cloud_voice_consent_required");

        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", user, document);
        assertThat(consent()).isEqualTo("undecided");

        UUID privacy = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                VALUES (?,'privacy','v9','ko','privacy','privacy',true,?)
                """, privacy, OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        jdbc.update("INSERT INTO user_consents(id,user_id,document_id,action,occurred_at) VALUES (?,?,?,'granted',now())",
                UUID.randomUUID(), user, privacy);
        assertThat(consent()).isEqualTo("granted");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fakes {
        @Bean @Primary VoiceModelStorage fakeVoiceModelStorage() {
            return new VoiceModelStorage() {
                public boolean configured() { return true; }
                public String downloadUrl(String key, int expiresInSeconds) { return "https://example.test/" + key; }
            };
        }
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
