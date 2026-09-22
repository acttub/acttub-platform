package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.feature.coach.app.CoachVideoSource;
import com.acttub.actingapi.feature.coach.app.DirectVideoCoach;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 새 저장소·HTTP·프로필을 실제로 연결하고 외부 영상/모델 경계만 대체한다. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false"})
@AutoConfigureMockMvc
@Import(DirectVideoPracticeIT.Fixture.class)
class DirectVideoPracticeIT {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("direct_video_practice");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper json;
    @Autowired CoachVideoSource videos;
    @Autowired DirectVideoModel model;
    @Autowired RecordingLlmTelemetry telemetry;
    @MockitoBean ObjectStorage storage;
    @MockitoBean TextGenerator text;
    UUID user;
    String bearer;
    CoachStorageFixtures fixtures;
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    @BeforeEach void prepare() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        fixtures = new CoachStorageFixtures(jdbc);
        user = fixtures.insertUser();
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
        reset(model);
        telemetry.clear();
        when(storage.downloadToPath(anyString(), any())).thenAnswer(call -> {
            Files.writeString(call.getArgument(1, Path.class), "test video");
            return new StoredObjectMetadata(10, "video/mp4", "etag");
        });
        when(model.upload(any(), anyString())).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("영상에서 상대를 붙잡는 흐름이 보여요.");
        when(text.generate(anyString(), anyString())).thenThrow(new IllegalStateException("note model unavailable"));
    }

    @Test void newPracticeUsesItsVideoAndCurrentProfileWithoutPersistingProfile() throws Exception {
        UUID practice = practice(UUID.randomUUID());
        jdbc.update("INSERT INTO actor_memories(id,user_id,field,value,written_by) VALUES (?,?,'goal','오디션 준비','actor')",
                UUID.randomUUID(), user);
        JsonNode opened = postJson("/v2/coach/start", Map.of("practice_id", practice, "request_id", UUID.randomUUID()));
        String conversation = opened.at("/conversation/id").asText();
        jdbc.update("UPDATE user_profiles SET experience='over_5y' WHERE user_id=?", user);
        JsonNode next = postJson("/v2/coach/reply", Map.of("conversation_id", conversation,
                "request_id", UUID.randomUUID(), "text", "상대를 붙잡고 싶어요"));
        assertThat(next.at("/conversation/messages")).hasSize(3);
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, times(2)).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getAllValues().getFirst()).contains("테스트 배우", "1–3년", "오디션 준비", "영상 근거가 아니다");
        assertThat(prompts.getAllValues().getLast()).contains("5년 이상").doesNotContain("1–3년");
        assertThat(telemetry.calls()).allSatisfy(call -> assertThat(call.input()).doesNotContain("테스트 배우"));
        var ended = postJson("/v2/coach/reply", Map.of("conversation_id", conversation,
                "request_id", UUID.randomUUID(), "text", "그만"));
        assertThat(ended.at("/conversation/status").asText()).isEqualTo("closed");
        assertThat(ended.at("/conversation/close_reason").asText()).isEqualTo("user_ended");
        assertThat(ended.at("/note/report/schema_version").asText()).isEqualTo("acttub.public_practice_note.v1");
        for (String tableColumn : List.of("coach_conversations.state", "coach_notes.legacy_report")) {
            String[] parts = tableColumn.split("\\.");
            assertThat(jdbc.queryForList("SELECT " + parts[1] + "::text FROM " + parts[0], String.class))
                    .allSatisfy(value -> assertThat(value).doesNotContain("테스트 배우", "5년 이상"));
        }
        verify(model, times(3)).delete(file);
    }

    @Test void migratedPracticeNeverFallsBackToPurgedOrForeignLegacyUpload() {
        var legacy = fixtures.insertPractice(user);
        assertThat(videos.find(user, legacy.id())).isNotNull();
        practice(legacy.id());
        var video = videos.find(user, legacy.id());
        assertThat(video.objectKey()).startsWith("videos/");
        assertThat(video.etag()).isEqualTo("etag");
        assertThat(videos.find(UUID.randomUUID(), legacy.id())).isNull();
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM practices WHERE id=?)", legacy.id());
        assertThat(videos.find(user, legacy.id())).isNull();
    }

    private UUID practice(UUID id) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',10,8000)",
                video, user, "videos/" + video);
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,
                                           duration_ms,expires_at,video_id,etag,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',10,8000,now(),?,'etag',now())
                """, UUID.randomUUID(), user, "videos/" + video, video);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'conversing','three_layers_v1','그 외','그 외')
                """, id, user, video, id);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'legacy','ready','test','{"scene_summary":"","observations":[],"uncertainties":[]}',now())
                """, UUID.randomUUID(), id);
        return id;
    }

    private JsonNode postJson(String path, Map<String, Object> body) throws Exception {
        var response = mvc.perform(post(path).header("Authorization", bearer).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body))).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return json.readTree(response.getContentAsString());
    }

    @TestConfiguration static class Fixture {
        @Bean DirectVideoModel directVideoModel() { return mock(DirectVideoModel.class); }
        @Bean @Primary RecordingLlmTelemetry recordingTelemetry() { return new RecordingLlmTelemetry(); }
        @Bean DirectVideoCoach directVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
                FailureReporter failures, RecordingLlmTelemetry telemetry) {
            return new DirectVideoCoach(model, videos, storage, failures, telemetry);
        }
    }
}
