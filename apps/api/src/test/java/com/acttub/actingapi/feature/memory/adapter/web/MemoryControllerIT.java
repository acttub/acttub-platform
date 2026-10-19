package com.acttub.actingapi.feature.memory.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 옛 기억 경로({@code /v2/legacy-me/memory}, 옛 표 {@code actor_memory_entries}) — practice.memory 「입력·출력」의
 * 옛 경로 줄. 스토어에 나간 옛 앱이 이 경로로 여섯 칸을 읽고 고친다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
@AutoConfigureMockMvc
class MemoryControllerIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("legacy_memory_controller");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    JwtService jwt;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    void actorWritesAreReadBackInScreenOrderAsEditedByMe() throws Exception {
        UUID practice = practiceSession();
        agentEntry("speech_actual", "빠르게 말한다", practice);

        MockHttpServletResponse written = send(put("/v2/legacy-me/memory/{field}", "goal")
                .contentType("application/json")
                .content("{\"value\":\"  무대 위에서 멈추지 않기  \"}"));
        send(put("/v2/legacy-me/memory/{field}", "gender").contentType("application/json")
                .content("{\"value\":\"여성\"}"));
        MockHttpServletResponse listed = send(get("/v2/legacy-me/memory"));

        assertThat(written.getStatus()).isEqualTo(200);
        assertThat(JSON.readTree(written.getContentAsString())).isEqualTo(JSON.readTree("""
                {"field":"goal","value":"무대 위에서 멈추지 않기","edited_by_me":true,"source_practice_session_id":null}
                """));
        assertThat(listed.getStatus()).isEqualTo(200);
        assertThat(JSON.readTree(listed.getContentAsString())).isEqualTo(JSON.readTree("""
                {"items":[
                  {"field":"gender","value":"여성","edited_by_me":true,"source_practice_session_id":null},
                  {"field":"goal","value":"무대 위에서 멈추지 않기","edited_by_me":true,"source_practice_session_id":null},
                  {"field":"speech_actual","value":"빠르게 말한다","edited_by_me":false,
                   "source_practice_session_id":"%s"}
                ]}
                """.formatted(practice)));
    }

    @Test
    void blankValueIsAFieldScopedValueErrorAndNothingIsStored() throws Exception {
        MockHttpServletResponse response = send(put("/v2/legacy-me/memory/{field}", "blockage")
                .contentType("application/json")
                .content("{\"value\":\"\\u00a0 \"}"));

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"value_error","loc":["body","value"],
                  "msg":"Value error, value must not be blank","input":"\\u00a0 ","ctx":{"error":{}}}]}
                """));
        assertThat(entryCount()).isZero();
    }

    @Test
    void fieldOutsideTheSixLegacyFieldsIsALiteralError() throws Exception {
        MockHttpServletResponse response = send(delete("/v2/legacy-me/memory/{field}", "tone"));

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"literal_error","loc":["path","field"],
                  "msg":"Input should be 'gender', 'age', 'goal', 'blockage', 'speech_self' or 'speech_actual'",
                  "input":"tone",
                  "ctx":{"expected":"'gender', 'age', 'goal', 'blockage', 'speech_self' or 'speech_actual'"}}]}
                """));
    }

    @Test
    void deletingOneFieldKeepsTheOthersAndDeletingTwiceOrEverythingIs204() throws Exception {
        agentEntry("goal", "목표", null);
        agentEntry("blockage", "막힘", null);

        MockHttpServletResponse first = send(delete("/v2/legacy-me/memory/{field}", "goal"));
        MockHttpServletResponse again = send(delete("/v2/legacy-me/memory/{field}", "goal"));

        assertThat(first.getStatus()).isEqualTo(204);
        assertThat(again.getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForList("SELECT field FROM actor_memory_entries WHERE user_id=?", String.class, member))
                .containsExactly("blockage");

        MockHttpServletResponse all = send(delete("/v2/legacy-me/memory"));

        assertThat(all.getStatus()).isEqualTo(204);
        assertThat(entryCount()).isZero();
        assertThat(JSON.readTree(send(get("/v2/legacy-me/memory")).getContentAsString()))
                .isEqualTo(JSON.readTree("{\"items\":[]}"));
    }

    private void agentEntry(String field, String value, UUID practice) {
        jdbc.update("""
                INSERT INTO actor_memory_entries(id,user_id,field,value,written_by,source_practice_session_id,
                                                 created_at,updated_at)
                VALUES (?,?,?,?,'agent',?,now(),now())
                """, UUID.randomUUID(), member, field, value, practice);
    }

    private UUID practiceSession() {
        UUID upload = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'pending','s3','k','video/mp4',1,now())
                """, upload, member);
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,
                                              blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzing','s','c','분석','캐릭터 분석','g')
                """, session, member, upload);
        return session;
    }

    private int entryCount() {
        return jdbc.queryForObject("SELECT count(*) FROM actor_memory_entries WHERE user_id=?", Integer.class, member);
    }

    private MockHttpServletResponse send(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", bearer)).andReturn().getResponse();
    }
}
