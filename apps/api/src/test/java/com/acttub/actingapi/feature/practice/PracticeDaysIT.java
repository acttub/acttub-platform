package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 연습한 날짜 목록 {@code GET /v2/practices/days} (SOMA-1003). 홈의 누적 연습일·연속일이 이걸 쓴다 — 기기를 바꾸거나
 * 다시 로그인해도 지난 리딩 날이 빠지지 않게 서버가 센다. 기준은 「연습 1회」(SOMA-773)와 같다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false"
})
@AutoConfigureMockMvc
class PracticeDaysIT {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_days");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
    }

    @Test
    @DisplayName("노트가 생긴 코칭·끝까지 읽은 리딩·올린 참여작만 한국 날짜로 하루 한 번 센다")
    void practiceDays_countOnlyCountedPracticesByKoreanDay() throws Exception {
        UUID actor = member();
        UUID other = member();

        // 코칭: 노트가 생긴 회차만. 한국 시간 자정 직후(UTC 로는 전날)는 한국 날짜로 센다.
        UUID noted = practice(actor, "2026-10-03T00:30", false);
        note(conversation(noted, "2026-10-03T00:31"), "2026-10-03T00:40");
        UUID talkedOnly = practice(actor, "2026-10-04T20:00", false);
        conversation(talkedOnly, "2026-10-04T20:01");
        // 숨긴 묶음도 그 날 연습한 사실은 남는다.
        UUID hidden = practice(actor, "2026-10-05T20:00", true);
        note(conversation(hidden, "2026-10-05T20:01"), "2026-10-05T20:10");
        // 같은 날 두 번 해도 하루다.
        UUID sameDay = practice(actor, "2026-10-05T21:00", false);
        note(conversation(sameDay, "2026-10-05T21:01"), "2026-10-05T21:10");

        // 리딩: 끝까지 읽은 회차만.
        reading(actor, "completed", "2026-10-06T19:00");
        reading(actor, "in_progress", "2026-10-07T19:00");

        // 챌린지: 올린 참여작.
        entry(actor, "2026-10-08T22:00");

        // 남의 기록은 섞이지 않는다.
        UUID theirs = practice(other, "2026-10-09T20:00", false);
        note(conversation(theirs, "2026-10-09T20:01"), "2026-10-09T20:10");

        assertThat(days(actor)).containsExactly("2026-10-03", "2026-10-05", "2026-10-06", "2026-10-08");
        assertThat(days(other)).containsExactly("2026-10-09");
    }

    @Test
    @DisplayName("연습한 적이 없으면 빈 목록이다")
    void practiceDays_emptyForNewActor() throws Exception {
        assertThat(days(member())).isEmpty();
    }

    private List<String> days(UUID userId) throws Exception {
        String bearer = "Bearer " + jwt.issueAccessToken(userId).value();
        var response = mvc.perform(get("/v2/practices/days").header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        List<String> out = new ArrayList<>();
        body.path("days").forEach(day -> out.add(day.textValue()));
        return out;
    }

    private static Timestamp kst(String dateTime) {
        return Timestamp.from(LocalDateTime.parse(dateTime).atZone(SEOUL).toInstant());
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private UUID practice(UUID userId, String at, boolean hidden) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                videoId, userId, "video/" + videoId, kst(at));
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,blockage_kind,sub_branch,created_at,hidden_at)
                VALUES (?,?,?,?,1,'closed','conversation_closed','three_layers_v1','분석','캐릭터 분석',?,?)
                """, id, userId, videoId, id, kst(at), hidden ? kst(at) : null);
        return id;
    }

    private UUID conversation(UUID practiceId, String at) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status,created_at) VALUES (?,?,?,'closed',?)",
                id, practiceId, UUID.randomUUID(), kst(at));
        return id;
    }

    private void note(UUID conversationId, String at) {
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision,next_take,fallback,created_at)
                VALUES (?,?,'v2','analysis',1,'다음 테이크',false,?)
                """, UUID.randomUUID(), conversationId, kst(at));
    }

    private void reading(UUID userId, String status, String at) {
        UUID scriptId = UUID.randomUUID();
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_fingerprint,created_at,updated_at) VALUES (?,?,'대본','r',repeat('0',64),'paste',?,?,?)",
                scriptId, userId, "f".repeat(64), kst(at), kst(at));
        UUID characterId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'역할',0)", characterId, scriptId);
        UUID lineId = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text,character_id) VALUES (?,?,0,'dialogue','안녕하세요',?)",
                lineId, scriptId, characterId);
        jdbc.update("""
                INSERT INTO reading_sessions(id,user_id,script_id,mode,advance,my_character_ids,start_line_id,end_line_id,status,record,started_at,updated_at)
                VALUES (?,?,?,'read','manual',ARRAY[?]::uuid[],?,?,?,false,?,?)
                """, UUID.randomUUID(), userId, scriptId, characterId, lineId, lineId, status, kst(at), kst(at));
    }

    private void entry(UUID userId, String at) {
        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (id,line,work,duration_days,origin,host_user_id,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?, '대사', '작품', 7, 'member', ?, ?, ?, ?, ?)
                """, challenge, userId, UUID.randomUUID(), "b".repeat(64), kst(at), kst(at).toInstant().plusSeconds(7 * 86_400).atOffset(ZoneOffset.UTC));
        UUID videoId = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at) VALUES (?,?,?,'video/mp4',1,1,?)",
                videoId, userId, "video/" + videoId, kst(at));
        jdbc.update("""
                INSERT INTO challenge_entries (id,challenge_id,user_id,video_id,visibility,request_id,request_fingerprint,created_at)
                VALUES (?, ?, ?, ?, 'private', ?, ?, ?)
                """, UUID.randomUUID(), challenge, userId, videoId, UUID.randomUUID(), "g".repeat(64), kst(at));
    }
}
