package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportModel;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.NotificationPushWorker;
import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.feature.push.app.PushSender;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 챌린지 알림함·푸시와 탈퇴 연결 (challenge.notification, account.withdraw). 실제 HTTP·Postgres 로 사건을 만들고, 발송은
 * 시각을 고정한 채 워커를 직접 부른다. 푸시 전달만 대체해 보낸 것을 기록한다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "CHALLENGE_SETTLEMENT_ENABLED=false", "CHALLENGE_NOTIFICATION_PUSH_ENABLED=false"})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ChallengeNotificationIT.Fakes.class})
class ChallengeNotificationIT {
    /** 한국 시간 낮 12시. */
    static final Instant NOON = Instant.parse("2026-09-23T03:00:00Z");

    @TestConfiguration
    static class Fakes {
        static final List<PushMessage> SENT = new CopyOnWriteArrayList<>();
        static volatile boolean failing;

        @Bean @Primary PushSender recordingChallengePushSender() {
            return messages -> {
                if (failing) throw new IllegalStateException("push service down");
                SENT.addAll(messages);
                return List.of();
            };
        }

        @Bean @Primary EntryMedia stubNotificationMedia() {
            return new EntryMedia() {
                @Override public int durationMs(String objectKey) { return 30_000; }
                @Override public String playbackUrl(String objectKey) { return null; }
            };
        }

        @Bean @Primary ChallengeReportModel stubNotificationReportModel() {
            return (mine, samples, instruction) -> new ChallengeReportModel.Output("""
                    {"observations":[{"start_ms":0,"end_ms":500,"text":"첫 문장 전에 멈춘다"}],"comparisons":[],"limits":[],
                     "suggestion":null}""", "stub");
        }

        @Bean @Primary com.acttub.actingapi.platform.security.FixedWindowRateLimiter everyNotificationRequestInANewWindow() {
            var nanos = new java.util.concurrent.atomic.AtomicLong();
            return new com.acttub.actingapi.platform.security.FixedWindowRateLimiter(() -> nanos.addAndGet(61_000_000_000L));
        }
    }

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge_notification");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired NotificationPushWorker pushes;
    @Autowired ChallengeReportWorker reports;
    @Autowired EntryRepository entries;
    UUID me;
    String bearer;
    UUID challenge;

    @BeforeEach void prepare() {
        clock.set(NOON);
        Fakes.SENT.clear();
        Fakes.failing = false;
        jdbc.execute("TRUNCATE users,challenges,ai_jobs RESTART IDENTITY CASCADE");
        me = member("나");
        bearer = token(me);
        device(me, "ExponentPushToken[me-1]", "ko");
        challenge = challenge(NOON.plus(Duration.ofDays(7)));
    }

    @Test void challengeNotification_aBurstOfLikesIsOneGroupWithAFirstAndASummaryPush() throws Exception {
        UUID mine = entry(challenge, me);
        String first = token(member("첫 팬"));
        response(put("/v2/entries/{id}/like", mine), 200, first);
        var row = jdbc.queryForMap("SELECT kind,comment_id,event_key,push_status,push_after FROM notifications");
        assertThat(row.get("kind")).isEqualTo("entry_liked");
        assertThat(row.get("comment_id")).isNull();
        assertThat((String) row.get("event_key")).startsWith("like:");
        assertThat(row.get("push_status")).isEqualTo("pending");
        response(put("/v2/entries/{id}/like", mine), 200, first);
        assertThat(count("notifications")).isEqualTo(1);
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(1);
        assertThat(Fakes.SENT.getFirst().body()).isEqualTo("내 참여작에 새 반응이 있어요");
        assertThat(Fakes.SENT.getFirst().body()).doesNotContain("첫 팬");
        assertThat(jdbc.queryForObject("SELECT stage FROM notification_pushes", String.class)).isEqualTo("first");
        for (int i = 0; i < 29; i++) {
            clock.advance(Duration.ofSeconds(10));
            response(put("/v2/entries/{id}/like", mine), 200, token(member("팬 " + i)));
        }
        assertThat(pushes.runOnce(clock.instant())).isZero();
        JsonNode inbox = response(get("/v2/me/notifications"), 200);
        assertThat(inbox.path("groups")).hasSize(1);
        assertThat(inbox.at("/groups/0/actor_count").asInt()).isEqualTo(30);
        clock.set(NOON.plus(Duration.ofMinutes(10)));
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT stage FROM notification_pushes ORDER BY stage", String.class))
                .containsExactly("first", "summary");
        assertThat(pushes.runOnce(clock.instant())).isZero();

        clock.set(NOON.plus(Duration.ofHours(1)));
        UUID quiet = entry(challenge, me);
        response(put("/v2/entries/{id}/like", quiet), 200, first);
        pushes.runOnce(clock.instant());
        clock.advance(Duration.ofMinutes(10));
        assertThat(pushes.runOnce(clock.instant())).isZero();
    }

    @Test void challengeNotification_cancelledLikesLeaveTheGroupAndRelikesCountOnce() throws Exception {
        UUID mine = entry(challenge, me);
        String fan = token(member("팬"));
        response(put("/v2/entries/{id}/like", mine), 200, fan);
        response(delete("/v2/entries/{id}/like", mine), 200, fan);
        assertThat(response(get("/v2/me/notifications"), 200).path("groups")).isEmpty();
        assertThat(pushes.runOnce(clock.instant())).isZero();
        assertThat(jdbc.queryForObject("SELECT push_status FROM notifications", String.class)).isEqualTo("skipped");
        response(put("/v2/entries/{id}/like", mine), 200, fan);
        assertThat(count("notifications")).isEqualTo(2);
        assertThat(response(get("/v2/me/notifications"), 200).at("/groups/0/actor_count").asInt()).isEqualTo(1);
    }

    @Test void challengeNotification_commentsCarryTheCommentAndDropWhenDeletedHiddenOrBlockedBeforeSending() throws Exception {
        UUID mine = entry(challenge, me);
        UUID writer = member("댓글 배우");
        String comment = response(post("/v2/entries/{id}/comments", mine).content(comment("호흡이 좋아요")), 201, token(writer))
                .path("id").asText();
        var row = jdbc.queryForMap("SELECT kind,comment_id,entry_id FROM notifications");
        assertThat(row.get("kind")).isEqualTo("entry_commented");
        assertThat(row.get("comment_id").toString()).isEqualTo(comment);
        JsonNode inbox = response(get("/v2/me/notifications"), 200);
        assertThat(inbox.at("/groups/0/comment_excerpt").asText()).isEqualTo("호흡이 좋아요");
        assertThat(inbox.at("/groups/0/actor_name").asText()).isEqualTo("댓글 배우");
        response(delete("/v2/comments/{id}", comment), 204, token(writer));
        assertThat(pushes.runOnce(clock.instant())).isZero();

        clock.advance(Duration.ofMinutes(20));
        UUID reporter = member("신고자");
        String hidden = response(post("/v2/entries/{id}/comments", mine).content(comment("숨겨질 댓글")), 201, token(writer))
                .path("id").asText();
        response(post("/v2/reports").content(json.writeValueAsString(Map.of("request_id", UUID.randomUUID(),
                "target_type", "comment", "target_id", hidden, "reason", "spam"))), 201, token(reporter));
        assertThat(pushes.runOnce(clock.instant())).isZero();

        clock.advance(Duration.ofMinutes(20));
        UUID rude = member("차단될 배우");
        response(post("/v2/entries/{id}/comments", mine).content(comment("무례한 댓글")), 201, token(rude));
        response(put("/v2/me/blocks/{id}", rude), 200);
        assertThat(pushes.runOnce(clock.instant())).isZero();
        assertThat(Fakes.SENT).isEmpty();
    }

    @Test void challengeNotification_endedChallengesNotifyEachParticipantOnceAndAiReportsNotifyTheOwner() throws Exception {
        Instant deadline = NOON.plus(Duration.ofHours(1));
        UUID ending = challenge(deadline);
        entry(ending, me);
        entry(ending, me);
        UUID leaver = member("지운 사람");
        UUID gone = entry(ending, leaver);
        response(delete("/v2/entries/{id}", gone), 204, token(leaver));
        clock.set(deadline.plus(Duration.ofMinutes(1)));
        entries.settle(clock.instant());
        assertThat(jdbc.queryForList("SELECT kind FROM notifications WHERE user_id=?", String.class, me)).containsExactly("challenge_ended");
        assertThat(jdbc.queryForObject("SELECT entry_id IS NULL FROM notifications WHERE user_id=?", Boolean.class, me)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id=?", Integer.class, leaver)).isZero();
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(1);
        assertThat(Fakes.SENT.getFirst().body()).isEqualTo("참여한 챌린지가 끝났어요");

        UUID secret = entry(challenge, me);
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", secret);
        response(post("/v2/entries/{id}/ai-report", secret).content(json.writeValueAsString(Map.of("request_id", UUID.randomUUID()))), 202);
        reports.runOnce(clock.instant());
        JsonNode inbox = response(get("/v2/me/notifications"), 200);
        assertThat(inbox.at("/groups/0/kind").asText()).isEqualTo("entry_ai_report_ready");
        assertThat(inbox.at("/groups/0/target_available").asBoolean()).isTrue();
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(1);
        assertThat(Fakes.SENT.getLast().body()).isEqualTo("AI 리포트가 준비됐어요");
    }

    @Test void challengeNotification_nightEventsWaitForNineAndDeliveryRechecksTheDevice() throws Exception {
        clock.set(Instant.parse("2026-09-23T14:00:00Z"));
        UUID mine = entry(challenge, me);
        response(put("/v2/entries/{id}/like", mine), 200, token(member("밤 팬")));
        assertThat(jdbc.queryForObject("SELECT push_after FROM notifications", java.sql.Timestamp.class).toInstant())
                .isEqualTo(Instant.parse("2026-09-24T00:00:00Z"));
        assertThat(pushes.runOnce(clock.instant())).isZero();
        device(me, "ExponentPushToken[me-2]", "ko");
        clock.set(Instant.parse("2026-09-24T00:00:00Z"));
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT push_attempted_at FROM notifications", java.sql.Timestamp.class).toInstant())
                .isEqualTo(clock.instant());

        clock.set(Instant.parse("2026-09-24T03:00:00Z"));
        Fakes.SENT.clear();
        UUID other = member("다른 계정");
        response(put("/v2/entries/{id}/like", mine), 200, token(member("낮 팬")));
        jdbc.update("UPDATE push_tokens SET user_id=? WHERE token='ExponentPushToken[me-2]'", other);
        jdbc.update("UPDATE push_tokens SET locale='en' WHERE token='ExponentPushToken[me-1]'");
        assertThat(pushes.runOnce(clock.instant())).isZero();

        clock.advance(Duration.ofHours(1));
        jdbc.update("UPDATE push_tokens SET locale='ko' WHERE token='ExponentPushToken[me-1]'");
        jdbc.update("UPDATE user_profiles SET notify_challenge=false WHERE user_id=?", me);
        response(put("/v2/entries/{id}/like", mine), 200, token(member("토글 끈 뒤 팬")));
        assertThat(jdbc.queryForObject("SELECT push_status FROM notifications ORDER BY created_at DESC LIMIT 1", String.class))
                .isEqualTo("skipped");
        jdbc.update("UPDATE user_profiles SET notify_challenge=true WHERE user_id=?", me);
        jdbc.update("DELETE FROM push_tokens WHERE user_id=?", me);
        clock.advance(Duration.ofHours(1));
        response(put("/v2/entries/{id}/like", mine), 200, token(member("토큰 없을 때 팬")));
        assertThat(jdbc.queryForObject("SELECT push_status FROM notifications ORDER BY created_at DESC LIMIT 1", String.class))
                .isEqualTo("skipped");
        assertThat(count("notifications")).isEqualTo(4);
    }

    @Test void challengeNotification_inboxPagesGroupsAndReadingMarksWholeGroupsOrUpToATime() throws Exception {
        var mine = new ArrayList<UUID>();
        for (int i = 0; i < 22; i++) {
            UUID entry = entry(challenge, me);
            mine.add(entry);
            response(put("/v2/entries/{id}/like", entry), 200, token(member("팬 " + i)));
            clock.advance(Duration.ofMinutes(1));
        }
        JsonNode first = response(get("/v2/me/notifications"), 200);
        assertThat(first.path("groups")).hasSize(20);
        assertThat(first.at("/groups/0/entry_id").asText()).isEqualTo(mine.getLast().toString());
        JsonNode rest = response(get("/v2/me/notifications").param("cursor", first.path("next_cursor").asText()), 200);
        assertThat(rest.path("groups")).hasSize(2);
        assertThat(response(get("/v2/me/notifications/unread-count"), 200).path("count").asInt()).isEqualTo(22);
        String group = first.at("/groups/0/group_key").asText();
        response(post("/v2/me/notifications/read").content(json.writeValueAsString(Map.of("group_keys", List.of(group)))), 204);
        assertThat(response(get("/v2/me/notifications/unread-count"), 200).path("count").asInt()).isEqualTo(21);
        String middle = first.at("/groups/10/latest_at").asText();
        response(post("/v2/me/notifications/read").content(json.writeValueAsString(Map.of("all_before",
                Map.of("created_at", middle, "id", first.at("/groups/10/group_key").asText())))), 204);
        // 11번째 묶음과 그보다 오래된 것이 읽혔다 — 남은 것은 두 번째~열 번째 묶음 아홉이다.
        assertThat(response(get("/v2/me/notifications/unread-count"), 200).path("count").asInt()).isEqualTo(9);
        response(post("/v2/me/notifications/read").content("{}"), 422);
    }

    @Test void challengeNotification_expiryDeletionPrivacyWithdrawalAndPushFailures() throws Exception {
        UUID mine = entry(challenge, me);
        UUID fan = member("떠날 팬");
        response(put("/v2/entries/{id}/like", mine), 200, token(fan));
        Fakes.failing = true;
        assertThat(pushes.runOnce(clock.instant())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT push_status FROM notifications", String.class)).isEqualTo("attempted");
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", fan);
        assertThat(response(get("/v2/me/notifications"), 200).at("/groups/0/actor_name").asText()).isEqualTo("탈퇴한 사용자");
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", mine);
        assertThat(response(get("/v2/me/notifications"), 200).at("/groups/0/target_available").asBoolean()).isFalse();
        UUID other = entry(challenge, me);
        response(put("/v2/entries/{id}/like", other), 200, token(member("남는 팬")));
        response(delete("/v2/entries/{id}", other), 204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications WHERE entry_id=?", Integer.class, other)).isZero();
        clock.advance(Duration.ofDays(91));
        entries.settle(clock.instant());
        // 남은 것은 이 정산이 방금 만든 챌린지 종료 알림뿐이다.
        assertThat(jdbc.queryForList("SELECT kind FROM notifications", String.class)).containsExactly("challenge_ended");
    }

    @Test void accountWithdraw_challengeDataIsClosedInTheSameTransaction() throws Exception {
        UUID friend = member("친구");
        String friendToken = token(friend);
        UUID hosted = UUID.fromString(response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "탈퇴 전 대사", "work", "창작", "duration_days", 7))), 201).path("id").asText());
        UUID mine = entry(challenge, me);
        UUID theirs = entry(challenge, friend);
        response(put("/v2/entries/{id}/save", theirs), 200);
        response(put("/v2/entries/{id}/like", theirs), 200);
        response(post("/v2/entries/{id}/comments", theirs).content(comment("탈퇴 전 댓글")), 201);
        response(put("/v2/me/blocks/{id}", member("차단한 사람")), 200);
        response(put("/v2/me/blocks/{id}", me), 200, token(member("나를 차단")));
        response(put("/v2/entries/{id}/like", mine), 200, friendToken);
        response(post("/v2/entries/{id}/ai-report", mine).content(json.writeValueAsString(Map.of("request_id", UUID.randomUUID()))), 202);
        reports.runOnce(clock.instant());
        response(delete("/v2/me"), 200);
        assertThat(jdbc.queryForObject("SELECT visibility FROM challenge_entries WHERE id=?", String.class, mine)).isEqualTo("private");
        assertThat(jdbc.queryForObject("SELECT host_user_id IS NULL FROM challenges WHERE id=?", Boolean.class, hosted)).isTrue();
        assertThat(jdbc.queryForObject("SELECT origin FROM challenges WHERE id=?", String.class, hosted)).isEqualTo("member");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_blocks", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_saves", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id=?", Integer.class, me)).isZero();
        assertThat(jdbc.queryForObject("SELECT result IS NULL AND purged_at IS NOT NULL FROM entry_ai_reports", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_likes WHERE entry_id=?", Integer.class, theirs)).isEqualTo(1);
        assertThat(response(get("/v2/entries/{id}/comments", theirs), 200, friendToken).at("/comments/0/author/name").asText())
                .isEqualTo("탈퇴한 사용자");
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200, friendToken).path("entries")).hasSize(1);
        clock.advance(Duration.ofDays(91));
        entries.settle(clock.instant());
        assertThat(count("entry_ai_reports")).isZero();
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    private UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, id.toString());
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    private void device(UUID user, String token, String locale) {
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform,locale) VALUES (?,?,'ios',?)", user, token, locale);
    }

    private String token(UUID id) { return "Bearer " + jwt.issueAccessToken(id).value(); }

    private UUID challenge(Instant endsAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,?,'창작',7,'team',?,?,?,?)
                """, id, "대사 " + id, UUID.randomUUID(), "0".repeat(64), java.sql.Timestamp.from(NOON.minus(Duration.ofDays(1))),
                java.sql.Timestamp.from(endsAt));
        return id;
    }

    private UUID entry(UUID challenge, UUID owner) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                video, owner, "videos/" + video);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint,published_at)
                VALUES (?,?,?,?,'public','visible',?,?,?)
                """, id, challenge, owner, video, UUID.randomUUID(), "0".repeat(64), java.sql.Timestamp.from(clock.instant()));
        return id;
    }

    private String comment(String body) throws Exception {
        return json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "body", body));
    }

    private int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected, bearer);
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        var result = mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/1.0.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn();
        var response = result.getResponse();
        assertThat(response.getStatus()).as("%s (%s)", response.getContentAsString(), result.getResolvedException()).isEqualTo(expected);
        return response.getContentAsString().isBlank() ? json.nullNode() : json.readTree(response.getContentAsString());
    }
}
