package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 코칭 탭 진행 표시(SOMA-810)의 스위치를 설정하지 않은(기본값 꺼짐) 서버. 묶음·회차 응답에 새 키가 하나도 없다 — 예전 응답과
 * 같은 바이트다. 켠 서버는 {@link CoachingTabProgressIT}.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class CoachingTabProgressOffIT {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    private String bearer;
    private UUID root;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        UUID video = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, member, "videos/" + member + "/" + video + ".mp4");
        root = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                      blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'closed','conversation_closed','three_layers_v1','분석','캐릭터 분석')
                """, root, member, video, root);
    }

    @Test
    @DisplayName("practice.library: 스위치가 꺼져 있으면 묶음에 practice_count·practice_goal, 회차에 video_duration_ms 키가 없다")
    void groups_withoutProgressKeys() throws Exception {
        JsonNode group = json("/v2/practices?filter=all").path("groups").path(0);

        assertThat(group.has("root_id")).isTrue();
        assertThat(group.has("practice_count")).isFalse();
        assertThat(group.has("practice_goal")).isFalse();
        assertThat(group.path("practices").path(0).has("id")).isTrue();
        assertThat(group.path("practices").path(0).has("video_duration_ms")).isFalse();
        assertThat(json("/v2/practices/" + root).has("video_duration_ms")).isFalse();
    }

    private JsonNode json(String path) throws Exception {
        var response = mvc.perform(get(path).header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }
}
