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
 * 코칭 탭 진행 표시(SOMA-810)를 <b>켠</b> 서버. 묶음에 「연습 1회」로 센 회차 수와 목표 3, 회차에 영상 길이가 실린다. 끈 서버는
 * {@link CoachingTabProgressOffIT}.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACTTUB_COACHING_TAB_PROGRESS_ENABLED=true"})
@AutoConfigureMockMvc
class CoachingTabProgressIT {

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
    private UUID second;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        root = UUID.randomUUID();
        second = UUID.randomUUID();
        // 첫 회차는 12초 영상으로 코칭을 받아 노트까지 생겼다. 둘째 회차는 길이를 모르는(0) 영상이고 대화만 하다 닫혔다.
        closedRound(root, root, 1, video(member, 12000), member);
        closedRound(second, root, 2, video(member, 0), member);
        note(conversation(root));
        conversation(second);
    }

    @Test
    @DisplayName("practice.library: 묶음에 노트가 생긴 회차 수와 목표 3, 회차에 영상 길이(ms)가 실리고 모르는 길이는 null 이다")
    void groups_carryProgressAndVideoLength() throws Exception {
        JsonNode group = json("/v2/practices?filter=all").path("groups").path(0);

        assertThat(group.path("practice_count").toString()).isEqualTo("1");
        assertThat(group.path("practice_goal").toString()).isEqualTo("3");
        assertThat(group.path("practices").path(0).path("video_duration_ms").toString()).isEqualTo("12000");
        assertThat(group.path("practices").path(1).has("video_duration_ms")).as("켠 서버는 값이 없어도 키를 싣는다").isTrue();
        assertThat(group.path("practices").path(1).path("video_duration_ms").isNull()).isTrue();
    }

    @Test
    @DisplayName("practice.library: 회차 하나를 읽어도 영상 길이가 같다")
    void find_carriesVideoLength() throws Exception {
        assertThat(json("/v2/practices/" + root).path("video_duration_ms").toString()).isEqualTo("12000");
        assertThat(json("/v2/practices/" + second).path("video_duration_ms").isNull()).isTrue();
    }

    private JsonNode json(String path) throws Exception {
        var response = mvc.perform(get(path).header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private UUID video(UUID owner, int durationMs) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,?)
                """, id, owner, "videos/" + owner + "/" + id + ".mp4", durationMs);
        return id;
    }

    private void closedRound(UUID id, UUID rootId, int ordinal, UUID videoId, UUID owner) {
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                      blockage_kind,sub_branch)
                VALUES (?,?,?,?,?,'closed','conversation_closed','three_layers_v1','분석','캐릭터 분석')
                """, id, owner, videoId, rootId, ordinal);
    }

    private UUID conversation(UUID practiceId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status) VALUES (?,?,?,'closed')",
                id, practiceId, UUID.randomUUID());
        return id;
    }

    private void note(UUID conversationId) {
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision,next_take,fallback)
                VALUES (?,?,'v2','action',1,'다음 테이크에서 한 박자 쉬어 보세요.',false)
                """, UUID.randomUUID(), conversationId);
    }
}
