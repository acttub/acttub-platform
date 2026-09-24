package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
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
 * 참여·랭킹·피드·조회수·종료 랭킹·P03 (challenge.entry, challenge.browse). 실제 HTTP 와 Postgres 를 쓰고 객체 저장소의
 * 길이 측정만 대체한다 — 기기가 적은 길이와 실제 길이를 따로 줄 수 있게.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "CHALLENGE_SETTLEMENT_ENABLED=false", "ADMIN_OPS_TOKEN=entry-test-ops"})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ChallengeEntryIT.Media.class})
class ChallengeEntryIT {
    static final Instant NOW = Instant.parse("2026-09-23T03:00:00Z");

    @TestConfiguration
    static class Media {
        static final Map<String, Integer> ACTUAL = new ConcurrentHashMap<>();
        @Bean @Primary EntryMedia stubEntryMedia() {
            return new EntryMedia() {
                @Override public int durationMs(String objectKey) { return ACTUAL.getOrDefault(objectKey, 30_000); }
                @Override public String playbackUrl(String objectKey) { return "https://play.test/" + objectKey; }
            };
        }
    }

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge_entry");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired EntryRepository entryRepository;
    UUID user;
    String bearer;

    @BeforeEach void prepare() {
        clock.set(NOW);
        Media.ACTUAL.clear();
        jdbc.execute("TRUNCATE users,challenges,upload_intents RESTART IDENTITY CASCADE");
        user = member("나");
        bearer = token(user);
    }

    // ── challenge.entry ────────────────────────────────────────────────────

    @Test void challengeEntry_publicEntryFromTheLibraryIsRankedAndExactlySixtySecondsIsAllowed() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        JsonNode entry = enter(challenge, video(user, 45_000), "public", 201);
        assertThat(entry.path("visibility").asText()).isEqualTo("public");
        assertThat(entry.path("status").asText()).isEqualTo("visible");
        assertThat(entry.path("category").asText()).isEqualTo("public");
        assertThat(Instant.parse(entry.path("published_at").asText())).isEqualTo(NOW);
        assertThat(entry.path("challenge").path("id").asText()).isEqualTo(challenge.toString());
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge), 200))).containsExactly(entry.path("id").asText());
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest"), 200)))
                .containsExactly(entry.path("id").asText());
        assertThat(response(get("/v2/challenges/{id}", challenge), 200).path("entry_count").asInt()).isEqualTo(1);
        UUID sixty = video(user, 60_000);
        Media.ACTUAL.put("videos/" + sixty, 60_000);
        enter(challenge, sixty, "public", 201);
    }

    @Test void challengeEntry_privateEntryIsOnlyInMyRecord() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        JsonNode entry = enter(challenge, video(user, 30_000), "private", 201);
        assertThat(entry.path("published_at").isNull()).isTrue();
        assertThat(entry.path("category").asText()).isEqualTo("private");
        UUID other = member("다른 배우");
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200, token(other)).path("entries")).isEmpty();
        assertThat(response(get("/v2/challenges/{id}", challenge), 200).path("entry_count").asInt()).isZero();
        assertThat(response(get("/v2/entries/{id}", entry.path("id").asText()), 404, token(other)).path("detail").asText())
                .isEqualTo("entry_not_found");
        JsonNode mine = response(get("/v2/me/challenge-entries"), 200);
        assertThat(mine.path("counts").path("private").asInt()).isEqualTo(1);
        assertThat(mine.path("counts").path("all").asInt()).isEqualTo(1);
        assertThat(ids(mine)).containsExactly(entry.path("id").asText());
    }

    @Test void challengeEntry_replaysBeforeQuotaAndRejectsChangedBodiesAndTheSameVideoTwice() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID video = video(user, 30_000);
        UUID request = UUID.randomUUID();
        String body = json.writeValueAsString(Map.of("request_id", request, "video_id", video, "visibility", "public"));
        JsonNode first = response(post("/v2/challenges/{id}/entries", challenge).content(body), 201);
        enter(challenge, video(user, 30_000), "public", 201);
        enter(challenge, video(user, 30_000), "private", 201);
        assertThat(response(post("/v2/challenges/{id}/entries", challenge).content(body), 200).path("id")).isEqualTo(first.path("id"));
        assertThat(response(post("/v2/challenges/{id}/entries", challenge).content(body.replace("public", "private")), 422)
                .path("detail").asText()).isEqualTo("request_fingerprint_mismatch");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM challenge_entries", Integer.class)).isEqualTo(3);
        clock.advance(Duration.ofDays(1));
        assertThat(enter(challenge, video, "public", 422).path("detail").asText()).isEqualTo("duplicate_entry");
    }

    @Test void challengeEntry_rejectsAFourthEntryClosedHiddenLongUnreadyAndForeignVideos() throws Exception {
        UUID open = challenge(NOW.plus(Duration.ofDays(7)));
        for (int i = 0; i < 3; i++) enter(open, video(user, 30_000), "public", 201);
        assertThat(enter(open, video(user, 30_000), "public", 429).path("detail").asText()).isEqualTo("daily_entry_limit");
        clock.advance(Duration.ofDays(1));
        UUID review = challenge(NOW.plus(Duration.ofDays(9)));
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", review);
        assertThat(enter(review, video(user, 30_000), "public", 404).path("detail").asText()).isEqualTo("challenge_not_found");
        assertThat(response(get("/v2/challenges/{id}/entries", review), 404).path("detail").asText()).isEqualTo("challenge_not_found");
        UUID declaredLong = video(user, 61_000);
        assertThat(enter(open, declaredLong, "public", 422).path("detail").asText()).isEqualTo("video_too_long");
        UUID actuallyLong = video(user, 30_000);
        Media.ACTUAL.put("videos/" + actuallyLong, 61_000);
        assertThat(enter(open, actuallyLong, "public", 422).path("detail").asText()).isEqualTo("video_too_long");
        UUID purged = video(user, 30_000);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=?", purged);
        assertThat(enter(open, purged, "public", 422).path("detail").asText()).isEqualTo("video_not_ready");
        UUID pending = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,request_id,storage_provider,object_key,mime_type,size_bytes,duration_ms,
                                           expires_at,status)
                VALUES (?,?,?,'s3',?,'video/mp4',100,30000,?,'pending')
                """, pending, user, UUID.randomUUID(), "videos/" + pending, java.sql.Timestamp.from(NOW.plus(Duration.ofDays(2))));
        assertThat(enter(open, pending, "public", 422).path("detail").asText()).isEqualTo("video_not_ready");
        assertThat(enter(open, video(member("남"), 30_000), "public", 404).path("detail").asText()).isEqualTo("video_not_found");
        clock.set(NOW.plus(Duration.ofDays(7)).plusSeconds(1));
        UUID late = video(user, 30_000);
        assertThat(enter(open, late, "public", 422).path("detail").asText()).isEqualTo("challenge_closed");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM videos WHERE id=?", Integer.class, late)).isEqualTo(1);
    }

    @Test void challengeEntry_visibilityTogglesKeepReactionsAndTheFirstPublicationTime() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        String entry = enter(challenge, video(user, 30_000), "public", 201).path("id").asText();
        likes(UUID.fromString(entry), 2);
        UUID other = member("관객");
        clock.advance(Duration.ofHours(1));
        assertThat(edit(entry, Map.of("visibility", "private"), 200).path("visibility").asText()).isEqualTo("private");
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200, token(other)).path("entries")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_likes WHERE entry_id=?::uuid", Integer.class, entry)).isEqualTo(2);
        clock.advance(Duration.ofHours(1));
        JsonNode reopened = edit(entry, Map.of("visibility", "public"), 200);
        assertThat(Instant.parse(reopened.path("published_at").asText())).isEqualTo(NOW);
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200, token(other)).at("/entries/0/like_count").asInt())
                .isEqualTo(2);
        jdbc.update("UPDATE challenge_entries SET visibility='private',status='hidden_by_report' WHERE id=?::uuid", entry);
        assertThat(edit(entry, Map.of("visibility", "public"), 422).path("detail").asText()).isEqualTo("entry_hidden");
        jdbc.update("UPDATE challenge_entries SET status='visible' WHERE id=?::uuid", entry);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?::uuid)", entry);
        assertThat(edit(entry, Map.of("visibility", "public"), 422).path("detail").asText()).isEqualTo("video_not_ready");
        jdbc.update("UPDATE videos SET purged_at=NULL");
        clock.set(NOW.plus(Duration.ofDays(8)));
        assertThat(edit(entry, Map.of("visibility", "public"), 422).path("detail").asText()).isEqualTo("challenge_closed");
        assertThat(edit(entry, Map.of("visibility", "private"), 200).path("visibility").asText()).isEqualTo("private");
    }

    @Test void challengeEntry_onlyTheAuthorEditsTheCaptionAndEachChangeBumpsTheVersion() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        String entry = enter(challenge, video(user, 30_000), "public", 201).path("id").asText();
        JsonNode edited = edit(entry, Map.of("caption", "  두 번째 테이크  "), 200);
        assertThat(edited.path("caption").asText()).isEqualTo("두 번째 테이크");
        assertThat(edited.path("content_version").asInt()).isEqualTo(2);
        assertThat(edit(entry, Map.of("caption", "두 번째 테이크"), 200).path("content_version").asInt()).isEqualTo(2);
        assertThat(edit(entry, Map.of("caption", ""), 200).path("caption").isNull()).isTrue();
        assertThat(response(patch("/v2/entries/{id}", entry).content("{\"caption\":\"남의 것\"}"), 404, token(member("남")))
                .path("detail").asText()).isEqualTo("entry_not_found");
        edit(entry, Map.of("caption", "😀".repeat(300)), 200);
        edit(entry, Map.of("caption", "😀".repeat(301)), 422);
    }

    @Test void challengeEntry_deleteReleasesTheVideoAndRemovesReactionsButKeepsTheRow() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID video = video(user, 30_000);
        UUID request = UUID.randomUUID();
        String body = json.writeValueAsString(Map.of("request_id", request, "video_id", video, "visibility", "public"));
        String entry = response(post("/v2/challenges/{id}/entries", challenge).content(body), 201).path("id").asText();
        likes(UUID.fromString(entry), 3);
        assertThat(response(delete("/v2/videos/{id}", video), 422).path("detail").asText()).isEqualTo("video_in_use");
        response(delete("/v2/entries/{id}", entry), 204);
        response(delete("/v2/entries/{id}", entry), 204);
        var row = jdbc.queryForMap("SELECT status,video_id,caption,deleted_at FROM challenge_entries WHERE id=?::uuid", entry);
        assertThat(row.get("status")).isEqualTo("deleted");
        assertThat(row.get("video_id")).isNull();
        assertThat(row.get("deleted_at")).isNotNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_likes WHERE entry_id=?::uuid", Integer.class, entry)).isZero();
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200).path("entries")).isEmpty();
        assertThat(response(get("/v2/me/challenge-entries"), 200).path("counts").path("all").asInt()).isZero();
        assertThat(response(post("/v2/challenges/{id}/entries", challenge).content(body), 200).path("status").asText())
                .isEqualTo("deleted");
        String again = enter(challenge, video, "public", 201).path("id").asText();
        assertThat(again).isNotEqualTo(entry);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM challenge_entries", Integer.class)).isEqualTo(2);
        response(delete("/v2/entries/{id}", again), 204);
        response(delete("/v2/videos/{id}", video), 204);
    }

    @Test void challengeEntry_firstEntryAndHostDeletionRaceOnTheChallengeRow() throws Exception {
        for (int round = 0; round < 5; round++) {
            String host = token(member("주최 " + round));
            JsonNode opened = response(post("/v2/challenges").content(json.writeValueAsString(Map.of("request_id", UUID.randomUUID(),
                    "line", "경합 " + round, "work", "창작", "duration_days", 7))), 201, host);
            UUID challenge = UUID.fromString(opened.path("id").asText());
            UUID actor = member("참여 " + round);
            String entryBody = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "video_id", video(actor, 30_000),
                    "visibility", "public"));
            try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
                var go = new java.util.concurrent.CountDownLatch(1);
                var entry = executor.submit(() -> { go.await(); return raw(post("/v2/challenges/{id}/entries", challenge)
                        .content(entryBody), token(actor)); });
                var removal = executor.submit(() -> { go.await(); return raw(delete("/v2/challenges/{id}", challenge), host); });
                go.countDown();
                int entered = entry.get(20, java.util.concurrent.TimeUnit.SECONDS).getStatus();
                int removed = removal.get(20, java.util.concurrent.TimeUnit.SECONDS).getStatus();
                assertThat(List.of(entered, removed)).as("한쪽만 성공한다").isIn(List.of(201, 422), List.of(404, 204));
                int rows = jdbc.queryForObject("SELECT count(*) FROM challenge_entries WHERE challenge_id=?", Integer.class, challenge);
                boolean deleted = jdbc.queryForObject("SELECT deleted_at IS NOT NULL FROM challenges WHERE id=?", Boolean.class, challenge);
                assertThat(rows == 1).isNotEqualTo(deleted);
            }
        }
    }

    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;

    @Test void challengeEntry_withdrawalBeforeTheWritePreventsALateEntry() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "video_id", video(user, 30_000),
                "visibility", "public"));
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var late = transaction.execute(status -> {
                int locker = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, user);
                var request = executor.submit(() -> raw(post("/v2/challenges/{id}/entries", challenge).content(body), bearer));
                org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).until(() ->
                        jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid)))",
                                Boolean.class, locker));
                jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", user);
                return request;
            }).get(20, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(late.getStatus()).isEqualTo(403);
            assertThat(json.readTree(late.getContentAsString()).path("detail").asText()).isEqualTo("account_deactivated");
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM challenge_entries", Integer.class)).isZero();
    }

    // ── challenge.browse ───────────────────────────────────────────────────

    @Test void challengeBrowse_ranksLikesWithSharedPlacesAndShowsLatestWithOneNewBadge() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID five = seeded(challenge, member("다섯"), 1, 5);
        UUID threeEarly = seeded(challenge, member("셋 먼저"), 2, 3);
        UUID threeLate = seeded(challenge, member("셋 나중"), 3, 3);
        JsonNode likes = response(get("/v2/challenges/{id}/entries", challenge), 200);
        assertThat(ids(likes)).containsExactly(five.toString(), threeEarly.toString(), threeLate.toString());
        assertThat(ranks(likes)).containsExactly("1", "2", "2");
        assertThat(likes.at("/entries/0/like_count").asInt()).isEqualTo(5);
        assertThat(likes.at("/entries/0/author/name").asText()).isEqualTo("다섯");
        assertThat(likes.at("/entries/0/author").has("photo_url")).isFalse();
        JsonNode latest = response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest"), 200);
        assertThat(ids(latest)).containsExactly(threeLate.toString(), threeEarly.toString(), five.toString());
        assertThat(latest.path("entries").findValues("rank")).allMatch(JsonNode::isNull);
        assertThat(latest.path("entries").findValuesAsText("is_new")).containsExactly("true", "false", "false");
        UUID zero = challenge(NOW.plus(Duration.ofDays(7)));
        seeded(zero, member("영 하나"), 1, 0);
        seeded(zero, member("영 둘"), 2, 0);
        assertThat(response(get("/v2/challenges/{id}/entries", zero), 200).path("entries").findValues("rank"))
                .allMatch(JsonNode::isNull);
    }

    @Test void challengeBrowse_blocksHideEntriesForTheViewerButKeepGlobalPlaces() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID blockedAuthor = member("차단된 배우");
        UUID leader = seeded(challenge, blockedAuthor, 1, 5);
        UUID second = seeded(challenge, member("둘째"), 2, 3);
        UUID blockedMe = member("나를 차단");
        UUID third = seeded(challenge, blockedMe, 3, 1);
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), user, blockedAuthor);
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), blockedMe, user);
        JsonNode mine = response(get("/v2/challenges/{id}/entries", challenge), 200);
        assertThat(ids(mine)).containsExactly(second.toString());
        assertThat(mine.at("/entries/0/rank").asInt()).isEqualTo(2);
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge), 200, token(member("관객")))))
                .containsExactly(leader.toString(), second.toString(), third.toString());
        assertThat(response(get("/v2/challenges/{id}", challenge), 200).path("like_sum").asInt()).isEqualTo(9);
        response(get("/v2/entries/{id}", leader), 404);
        assertThat(response(post("/v2/entries/{id}/views", third).content(view(UUID.randomUUID())), 404).path("detail").asText())
                .isEqualTo("entry_not_found");
    }

    @Test void challengeBrowse_feedPagesTwentyAtATimeAndCanStartFromAnEntry() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        var byRank = new ArrayList<String>();
        for (int i = 0; i < 25; i++) byRank.add(seeded(challenge, member("배우 " + i), i, 30 - i).toString());
        JsonNode first = response(get("/v2/challenges/{id}/entries", challenge), 200);
        assertThat(ids(first)).containsExactlyElementsOf(byRank.subList(0, 20));
        JsonNode second = response(get("/v2/challenges/{id}/entries", challenge).param("cursor", first.path("next_cursor").asText()), 200);
        assertThat(ids(second)).containsExactlyElementsOf(byRank.subList(20, 25));
        assertThat(second.path("next_cursor").isNull()).isTrue();
        JsonNode fromThird = response(get("/v2/challenges/{id}/entries", challenge).param("from_entry", byRank.get(2)), 200);
        assertThat(ids(fromThird)).containsExactlyElementsOf(byRank.subList(2, 22));
        assertThat(fromThird.at("/entries/0/rank").asInt()).isEqualTo(3);
        JsonNode latest = response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest"), 200);
        JsonNode rest = response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest")
                .param("cursor", latest.path("next_cursor").asText()), 200);
        assertThat(ids(latest).size() + ids(rest).size()).isEqualTo(25);
        UUID empty = challenge(NOW.plus(Duration.ofDays(7)));
        assertThat(response(get("/v2/challenges/{id}/entries", empty), 200).path("entries")).isEmpty();
        assertThat(response(get("/v2/challenges/{id}/entries", challenge).param("cursor", "not-a-cursor"), 422)).isNotNull();
    }

    @Test void challengeBrowse_heldOrderSurvivesOvertakingButRechecksVisibilityAndExpiresWhenTheBasisChanges() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofHours(1)));
        var byRank = new ArrayList<UUID>();
        for (int i = 0; i < 22; i++) byRank.add(seeded(challenge, member("배우 " + i), i, 40 - i));
        JsonNode first = response(get("/v2/challenges/{id}/entries", challenge), 200);
        String cursor = first.path("next_cursor").asText();
        likes(byRank.get(21), 100);
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", byRank.get(20));
        clock.advance(Duration.ofMinutes(9));
        JsonNode next = response(get("/v2/challenges/{id}/entries", challenge).param("cursor", cursor), 200);
        assertThat(ids(next)).containsExactly(byRank.get(21).toString());
        assertThat(next.at("/entries/0/rank").asInt()).isEqualTo(22);
        assertThat(next.at("/entries/0/like_count").asInt()).isEqualTo(119);
        clock.advance(Duration.ofMinutes(2));
        assertThat(response(get("/v2/challenges/{id}/entries", challenge).param("cursor", cursor), 410).path("detail").asText())
                .isEqualTo("cursor_expired");
        String fresh = response(get("/v2/challenges/{id}/entries", challenge), 200).path("next_cursor").asText();
        clock.set(NOW.plus(Duration.ofHours(1)));
        assertThat(response(get("/v2/challenges/{id}/entries", challenge).param("cursor", fresh), 410).path("detail").asText())
                .isEqualTo("cursor_expired");
    }

    @Test void challengeBrowse_countsViewsOncePerEventAndNeverForTheAuthor() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        String entry = enter(challenge, video(user, 30_000), "public", 201).path("id").asText();
        String viewer = token(member("관객"));
        UUID event = UUID.randomUUID();
        response(post("/v2/entries/{id}/views", entry).content(view(event)), 204, viewer);
        response(post("/v2/entries/{id}/views", entry).content(view(event)), 204, viewer);
        response(post("/v2/entries/{id}/views", entry).content(view(UUID.randomUUID())), 204);
        assertThat(jdbc.queryForObject("SELECT view_count FROM challenge_entries WHERE id=?::uuid", Long.class, entry)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_view_events", Integer.class)).isEqualTo(1);
        response(post("/v2/entries/{id}/views", entry).content(view(UUID.randomUUID())), 204, viewer);
        assertThat(response(get("/v2/entries/{id}", entry), 200, viewer).path("view_count").asInt()).isEqualTo(2);
        clock.advance(Duration.ofDays(8));
        entryRepository.settle(clock.instant());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM entry_view_events", Integer.class)).isZero();
    }

    @Test void challengeBrowse_firstChangeAfterTheDeadlineFreezesLikesAndPlacesAreNotPulledUp() throws Exception {
        Instant deadline = NOW.plus(Duration.ofHours(2));
        UUID challenge = challenge(deadline);
        String mine = enter(challenge, video(user, 30_000), "public", 201).path("id").asText();
        likes(UUID.fromString(mine), 4);
        UUID second = seeded(challenge, member("둘째"), 1, 3);
        UUID third = seeded(challenge, member("셋째"), 2, 1);
        clock.set(deadline.plus(Duration.ofMinutes(5)));
        jdbc.update("DELETE FROM entry_likes WHERE id=(SELECT id FROM entry_likes WHERE entry_id=? LIMIT 1)", second);
        edit(mine, Map.of("caption", "마감 뒤 첫 변경"), 200);
        assertThat(jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, challenge)).isEqualTo("final");
        assertThat(jdbc.queryForObject("SELECT final_like_count FROM challenge_entries WHERE id=?", Long.class, second)).isEqualTo(2);
        edit(mine, Map.of("visibility", "private"), 200);
        likes(third, 10);
        JsonNode ranking = response(get("/v2/challenges/{id}/entries", challenge), 200, token(member("관객")));
        assertThat(ids(ranking)).containsExactly(second.toString(), third.toString());
        assertThat(ranks(ranking)).containsExactly("2", "3");
        assertThat(ranking.path("ranking_state").asText()).isEqualTo("final");
        assertThat(ranking.at("/entries/1/final_like_count").asInt()).isEqualTo(1);
        assertThat(ranking.at("/entries/1/like_count").asInt()).isEqualTo(11);
    }

    @Test void challengeBrowse_reviewAtTheDeadlineKeepsRanksPendingUntilItEnds() throws Exception {
        Instant deadline = NOW.plus(Duration.ofHours(2));
        UUID challenge = challenge(deadline);
        UUID hidden = seeded(challenge, member("확인 중"), 1, 10);
        UUID shown = seeded(challenge, member("공개"), 2, 4);
        jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", hidden);
        UUID report = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,target_version,request_id,request_fingerprint)
                VALUES (?,'entry',?,?,'spam',1,?,?)
                """, report, hidden, member("신고자"), UUID.randomUUID(), "0".repeat(64));
        clock.set(deadline.plus(Duration.ofMinutes(1)));
        assertThat(entryRepository.settle(clock.instant())).isEqualTo(1);
        JsonNode pending = response(get("/v2/challenges/{id}/entries", challenge), 200);
        assertThat(pending.path("ranking_state").asText()).isEqualTo("pending");
        assertThat(pending.path("entries").findValues("rank")).allMatch(JsonNode::isNull);
        response(patch("/v2/admin/reports/{id}", report).content("{\"resolution\":\"restored\",\"reviewer\":\"운영\"}"), 200,
                "Bearer entry-test-ops");
        JsonNode settled = response(get("/v2/challenges/{id}/entries", challenge), 200);
        assertThat(ids(settled)).containsExactly(hidden.toString(), shown.toString());
        assertThat(ranks(settled)).containsExactly("1", "2");
        assertThat(entryRepository.settle(clock.instant())).isZero();

        UUID reviewed = challenge(clock.instant().plus(Duration.ofHours(1)));
        seeded(reviewed, member("검토 참여"), 1, 2);
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", reviewed);
        clock.advance(Duration.ofHours(2));
        entryRepository.settle(clock.instant());
        assertThat(jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, reviewed)).isEqualTo("pending");
        response(patch("/v2/admin/challenges/{id}/moderation", reviewed).content("{\"moderation\":\"visible\"}"), 200,
                "Bearer entry-test-ops");
        assertThat(jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, reviewed)).isEqualTo("final");
    }

    @Test void challengeBrowse_myRecordCountsEachEntryInOneCategory() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID other = challenge(NOW.plus(Duration.ofDays(7)));
        String hiddenPrivate = enter(challenge, video(user, 30_000), "private", 201).path("id").asText();
        jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?::uuid", hiddenPrivate);
        enter(challenge, video(user, 30_000), "public", 201);
        enter(other, video(user, 30_000), "private", 201);
        clock.advance(Duration.ofDays(1));
        enter(other, video(user, 30_000), "public", 201);
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", other);
        JsonNode record = response(get("/v2/me/challenge-entries"), 200);
        assertThat(record.path("counts").path("all").asInt()).isEqualTo(4);
        assertThat(record.path("counts").path("under_review").asInt()).isEqualTo(3);
        assertThat(record.path("counts").path("public").asInt()).isEqualTo(1);
        assertThat(record.path("counts").path("private").asInt()).isZero();
        assertThat(ids(response(get("/v2/me/challenge-entries").param("visibility", "under_review"), 200))).hasSize(3);
        assertThat(response(get("/v2/entries/{id}", hiddenPrivate), 200).path("id").asText()).isEqualTo(hiddenPrivate);
    }

    @Test void challengeBrowse_guestsAndWebClientsAreRefused() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        var result = mvc.perform(get("/v2/challenges/{id}/entries", challenge).header("Authorization", bearer)
                .header("X-Acttub-Client", "web/1.0.0").header("Accept-Language", "ko")).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(403);
        assertThat(json.readTree(result.getContentAsString()).path("detail").asText()).isEqualTo("member_only");
    }

    // ── challenge.share ────────────────────────────────────────────────────

    @Test void challengeShare_publicLookupShowsTheSceneOfPubliclyVisibleEntriesOnlyWithoutLogin() throws Exception {
        UUID challenge = challenge(NOW.plus(Duration.ofDays(7)));
        jdbc.update("UPDATE challenges SET work='햄릿',line='죽느냐 사느냐',\"character\"='햄릿' WHERE id=?", challenge);
        UUID author = member("공개한 배우");
        UUID shown = seeded(challenge, author, 1, 2);
        var ok = publicLookup(shown);
        assertThat(ok.getStatus()).isEqualTo(200);
        assertThat(ok.getHeader("X-Robots-Tag")).isEqualTo("noindex, nofollow");
        // 작성자의 이름·사진은 싣지 않는다 — 미리보기는 작품·대사·장면만 보여 준다.
        assertThat(json.readTree(ok.getContentAsString())).isEqualTo(json.readTree("""
                {"work":"햄릿","line":"죽느냐 사느냐","character":"햄릿","poster_url":null}"""));
        // 보는 사람이 없으니 차단은 따지지 않는다. 만료된 토큰이 붙어 와도 검증하지 않는다.
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), user, author);
        var withStaleToken = mvc.perform(get("/v2/public/entries/{id}", shown).header("Authorization", "Bearer expired")
                .header("X-Acttub-Client", "web/1.0.0")).andReturn().getResponse();
        assertThat(withStaleToken.getStatus()).isEqualTo(200);

        UUID secret = seeded(challenge, member("비공개"), 2, 0);
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", secret);
        UUID reported = seeded(challenge, member("신고로 숨김"), 3, 0);
        jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", reported);
        UUID removed = seeded(challenge, member("삭제"), 4, 0);
        jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", removed);
        UUID leaver = member("탈퇴");
        UUID withdrawn = seeded(challenge, leaver, 5, 0);
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", leaver);
        UUID purged = seeded(challenge, member("영상 파기"), 6, 0);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        UUID hiddenChallenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID underHidden = seeded(hiddenChallenge, member("숨긴 챌린지"), 1, 0);
        jdbc.update("UPDATE challenges SET moderation='hidden' WHERE id=?", hiddenChallenge);
        UUID reviewChallenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID underReview = seeded(reviewChallenge, member("검토 챌린지"), 1, 0);
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", reviewChallenge);
        UUID deletedChallenge = challenge(NOW.plus(Duration.ofDays(7)));
        UUID underDeleted = seeded(deletedChallenge, member("지운 챌린지"), 1, 0);
        jdbc.update("UPDATE challenges SET deleted_at=now() WHERE id=?", deletedChallenge);

        for (UUID gone : List.of(secret, reported, removed, withdrawn, purged, underHidden, underReview, underDeleted,
                UUID.randomUUID())) {
            var missing = publicLookup(gone);
            assertThat(missing.getStatus()).as("%s", gone).isEqualTo(404);
            assertThat(json.readTree(missing.getContentAsString()).path("detail").asText()).isEqualTo("entry_not_found");
        }
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    /** 로그인 없는 웹 서버의 조회 — 토큰을 싣지 않는다. */
    private org.springframework.mock.web.MockHttpServletResponse publicLookup(UUID entry) throws Exception {
        return mvc.perform(get("/v2/public/entries/{id}", entry).header("X-Acttub-Client", "web/1.0.0")
                .header("Accept-Language", "ko")).andReturn().getResponse();
    }

    private UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, id.toString());
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    private String token(UUID id) { return "Bearer " + jwt.issueAccessToken(id).value(); }

    private UUID challenge(Instant endsAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,?,'창작',7,'team',?,?,?,?)
                """, id, "대사 " + id, UUID.randomUUID(), "0".repeat(64), java.sql.Timestamp.from(NOW.minus(Duration.ofDays(1))),
                java.sql.Timestamp.from(endsAt));
        return id;
    }

    private UUID video(UUID owner, int declaredMs) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,?)",
                id, owner, "videos/" + id, declaredMs);
        return id;
    }

    /** 다른 배우의 공개 참여작. 공개 시각은 NOW 뒤 {@code order} 분이다. */
    private UUID seeded(UUID challenge, UUID owner, int order, int likeCount) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint,
                                              published_at,created_at)
                VALUES (?,?,?,?,'public','visible',?,?,?,?)
                """, id, challenge, owner, video(owner, 30_000), UUID.randomUUID(), "0".repeat(64),
                java.sql.Timestamp.from(NOW.minus(Duration.ofHours(1)).plus(Duration.ofMinutes(order))),
                java.sql.Timestamp.from(NOW.minus(Duration.ofHours(1))));
        likes(id, likeCount);
        return id;
    }

    private void likes(UUID entry, int count) {
        for (int i = 0; i < count; i++) {
            UUID fan = UUID.randomUUID();
            jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", fan);
            jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, fan);
        }
    }

    private JsonNode enter(UUID challenge, UUID video, String visibility, int status) throws Exception {
        return response(post("/v2/challenges/{id}/entries", challenge).content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "video_id", video, "visibility", visibility))), status);
    }

    private JsonNode edit(String entry, Map<String, String> body, int status) throws Exception {
        return response(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/v2/entries/{id}", entry)
                .content(json.writeValueAsString(body)), status);
    }

    private String view(UUID event) throws Exception { return json.writeValueAsString(Map.of("event_id", event)); }

    private static List<String> ids(JsonNode page) {
        var ids = new ArrayList<String>();
        page.path("entries").forEach(entry -> ids.add(entry.path("id").asText()));
        return ids;
    }

    private static List<String> ranks(JsonNode page) {
        var ranks = new ArrayList<String>();
        page.path("entries").forEach(entry -> ranks.add(entry.path("rank").asText()));
        return ranks;
    }

    private org.springframework.mock.web.MockHttpServletResponse raw(MockHttpServletRequestBuilder request, String authorization)
            throws Exception {
        return mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/1.0.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
    }

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
