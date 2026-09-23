package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
 * 좋아요·저장·댓글·차단·신고와 운영 처리 (challenge.react, challenge.block, challenge.report). 실제 HTTP 와 Postgres 로
 * 노출 조건·멱등·한도·숨김·해제를 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "CHALLENGE_SETTLEMENT_ENABLED=false", "ADMIN_OPS_TOKEN=reaction-test-ops"})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ChallengeReactionIT.Media.class})
class ChallengeReactionIT {
    static final Instant NOW = Instant.parse("2026-09-23T03:00:00Z");
    static final String OPS = "Bearer reaction-test-ops";

    @TestConfiguration
    static class Media {
        @Bean @Primary EntryMedia stubReactionMedia() {
            return new EntryMedia() {
                @Override public int durationMs(String objectKey) { return 30_000; }
                @Override public String playbackUrl(String objectKey) { return "https://play.test/" + objectKey; }
            };
        }

        /** 하루 한도(댓글 100·신고 20)를 보려면 분당 요청 제한을 넘어야 한다 — 요청마다 창이 바뀌는 시계를 준다. */
        @Bean @Primary com.acttub.actingapi.platform.security.FixedWindowRateLimiter everyRequestInANewWindow() {
            var nanos = new java.util.concurrent.atomic.AtomicLong();
            return new com.acttub.actingapi.platform.security.FixedWindowRateLimiter(() -> nanos.addAndGet(61_000_000_000L));
        }
    }

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge_reaction");
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
    UUID me;
    String bearer;
    UUID challenge;

    @BeforeEach void prepare() {
        clock.set(NOW);
        jdbc.execute("TRUNCATE users,challenges RESTART IDENTITY CASCADE");
        me = member("나");
        bearer = token(me);
        challenge = challenge(NOW.plus(Duration.ofDays(7)));
    }

    // ── challenge.react ────────────────────────────────────────────────────

    @Test void challengeReact_likesAreIdempotentAndRecounted() throws Exception {
        UUID entry = entry(challenge, member("배우"));
        assertThat(response(put("/v2/entries/{id}/like", entry), 200).path("like_count").asInt()).isEqualTo(1);
        assertThat(response(put("/v2/entries/{id}/like", entry), 200).path("like_count").asInt()).isEqualTo(1);
        assertThat(count("entry_likes")).isEqualTo(1);
        assertThat(response(get("/v2/entries/{id}", entry), 200).path("liked").asBoolean()).isTrue();
        JsonNode off = response(delete("/v2/entries/{id}/like", entry), 200);
        assertThat(off.path("like_count").asInt()).isZero();
        assertThat(off.path("liked").asBoolean()).isFalse();
        response(delete("/v2/entries/{id}/like", entry), 200);
        assertThat(count("entry_likes")).isZero();
    }

    @Test void challengeReact_reactionsNeedAVisibleEntryOfSomeoneElse() throws Exception {
        UUID mine = entry(challenge, me);
        assertThat(detail(put("/v2/entries/{id}/like", mine), 422)).isEqualTo("self_like");
        assertThat(detail(put("/v2/entries/{id}/save", mine), 422)).isEqualTo("self_save");
        UUID hidden = entry(challenge, member("비공개"));
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", hidden);
        assertThat(detail(put("/v2/entries/{id}/like", hidden), 404)).isEqualTo("entry_not_found");
        UUID deleted = entry(challenge, member("삭제"));
        jdbc.update("UPDATE challenge_entries SET status='deleted',video_id=NULL,deleted_at=now() WHERE id=?", deleted);
        assertThat(detail(put("/v2/entries/{id}/like", deleted), 404)).isEqualTo("entry_not_found");
        UUID review = challenge(NOW.plus(Duration.ofDays(7)));
        UUID inReview = entry(review, member("검토"));
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", review);
        assertThat(detail(put("/v2/entries/{id}/save", inReview), 404)).isEqualTo("entry_not_found");
        UUID blockedByMe = member("내가 차단");
        UUID blocksMe = member("나를 차단");
        UUID first = entry(challenge, blockedByMe);
        UUID second = entry(challenge, blocksMe);
        response(put("/v2/me/blocks/{id}", blockedByMe), 200);
        response(put("/v2/me/blocks/{id}", me), 200, token(blocksMe));
        assertThat(detail(put("/v2/entries/{id}/like", first), 404)).isEqualTo("entry_not_found");
        assertThat(detail(post("/v2/entries/{id}/comments", second).content(comment("안녕")), 404)).isEqualTo("entry_not_found");
        assertThat(detail(get("/v2/entries/{id}/comments", hidden), 404)).isEqualTo("entry_not_found");
    }

    @Test void challengeReact_likesAfterTheDeadlineChangeTheCountButNotTheFinalRanking() throws Exception {
        Instant deadline = NOW.plus(Duration.ofHours(1));
        UUID ending = challenge(deadline);
        UUID entry = entry(ending, member("배우"));
        response(put("/v2/entries/{id}/like", entry), 200, token(member("팬")));
        clock.set(deadline.plus(Duration.ofMinutes(5)));
        assertThat(response(put("/v2/entries/{id}/like", entry), 200).path("like_count").asInt()).isEqualTo(2);
        var row = jdbc.queryForMap("SELECT final_like_count,final_rank FROM challenge_entries WHERE id=?", entry);
        assertThat(row.get("final_like_count")).isEqualTo(1L);
        assertThat(row.get("final_rank")).isEqualTo(1);
        response(delete("/v2/entries/{id}/like", entry), 200);
        assertThat(jdbc.queryForObject("SELECT final_like_count FROM challenge_entries WHERE id=?", Long.class, entry)).isEqualTo(1);
    }

    @Test void challengeReact_savedEntriesFollowVisibilityAndDisappearWithTheEntry() throws Exception {
        UUID author = member("배우");
        UUID older = entry(challenge, author);
        UUID newer = entry(challenge, member("다른 배우"));
        entry(challenge, me);
        response(put("/v2/entries/{id}/save", older), 200);
        clock.advance(Duration.ofMinutes(1));
        response(put("/v2/entries/{id}/save", newer), 200);
        response(put("/v2/entries/{id}/save", newer), 200);
        assertThat(count("entry_saves")).isEqualTo(2);
        JsonNode saved = response(get("/v2/me/saved-entries"), 200);
        assertThat(ids(saved, "entries")).containsExactly(newer.toString(), older.toString());
        assertThat(saved.path("my_entry_count").asInt()).isEqualTo(1);
        assertThat(saved.path("saved_count").asInt()).isEqualTo(2);
        assertThat(saved.at("/entries/0/saved").asBoolean()).isTrue();
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", older);
        assertThat(ids(response(get("/v2/me/saved-entries"), 200), "entries")).containsExactly(newer.toString());
        assertThat(count("entry_saves")).isEqualTo(2);
        jdbc.update("UPDATE challenge_entries SET visibility='public' WHERE id=?", older);
        assertThat(ids(response(get("/v2/me/saved-entries"), 200), "entries")).hasSize(2);
        response(delete("/v2/entries/{id}", older), 204, token(author));
        assertThat(count("entry_saves")).isEqualTo(1);
        response(delete("/v2/entries/{id}/save", newer), 200);
        response(delete("/v2/entries/{id}/save", newer), 200);
        assertThat(count("entry_saves")).isZero();
    }

    @Test void challengeReact_commentsAreIdempotentLimitedAndShowOnlyTheCurrentName() throws Exception {
        UUID author = member("배우");
        UUID entry = entry(challenge, author);
        UUID request = UUID.randomUUID();
        String body = json.writeValueAsString(Map.of("request_id", request, "body", "  좋은 호흡이에요  "));
        JsonNode created = response(post("/v2/entries/{id}/comments", entry).content(body), 201);
        assertThat(created.path("body").asText()).isEqualTo("좋은 호흡이에요");
        assertThat(created.path("author").path("name").asText()).isEqualTo("나");
        assertThat(created.path("author").has("photo_url")).isFalse();
        assertThat(created.path("is_mine").asBoolean()).isTrue();
        assertThat(response(post("/v2/entries/{id}/comments", entry).content(body), 200).path("id")).isEqualTo(created.path("id"));
        assertThat(detail(post("/v2/entries/{id}/comments", entry).content(body.replace("좋은", "나쁜")), 422))
                .isEqualTo("request_fingerprint_mismatch");
        assertThat(count("entry_comments")).isEqualTo(1);
        jdbc.update("UPDATE user_profiles SET name='새 이름' WHERE user_id=?", me);
        assertThat(response(get("/v2/entries/{id}/comments", entry), 200).at("/comments/0/author/name").asText()).isEqualTo("새 이름");
        response(post("/v2/entries/{id}/comments", entry).content(comment("   ")), 422);
        response(post("/v2/entries/{id}/comments", entry).content(comment("가".repeat(501))), 422);
        response(post("/v2/entries/{id}/comments", entry).content(comment("😀".repeat(500))), 201);
        UUID mine = entry(challenge, me);
        response(post("/v2/entries/{id}/comments", mine).content(comment("내 참여작에도")), 201);
        for (int i = 3; i < 100; i++) {
            clock.advance(Duration.ofSeconds(1));
            response(post("/v2/entries/{id}/comments", entry).content(comment("댓글 " + i)), 201);
        }
        assertThat(detail(post("/v2/entries/{id}/comments", entry).content(comment("101번째")), 429)).isEqualTo("daily_comment_limit");
        JsonNode first = response(get("/v2/entries/{id}/comments", entry), 200);
        assertThat(first.path("comments")).hasSize(20);
        assertThat(first.at("/comments/0/body").asText()).isEqualTo("댓글 99");
        JsonNode next = response(get("/v2/entries/{id}/comments", entry).param("cursor", first.path("next_cursor").asText()), 200);
        assertThat(next.at("/comments/0/body").asText()).isEqualTo("댓글 79");
        clock.advance(Duration.ofDays(1));
        response(post("/v2/entries/{id}/comments", entry).content(comment("다음 날")), 201);
        assertThat(response(get("/v2/entries/{id}", entry), 200).path("comment_count").asInt()).isEqualTo(100);
    }

    @Test void challengeReact_onlyTheAuthorDeletesAndHiddenOwnCommentsStayVisibleToThem() throws Exception {
        UUID author = member("배우");
        UUID entry = entry(challenge, author);
        String id = response(post("/v2/entries/{id}/comments", entry).content(comment("지울 댓글")), 201).path("id").asText();
        assertThat(detail(delete("/v2/comments/{id}", id), 404, token(author))).isEqualTo("comment_not_found");
        response(delete("/v2/comments/{id}", id), 204);
        response(delete("/v2/comments/{id}", id), 204);
        var row = jdbc.queryForMap("SELECT body,deleted_at FROM entry_comments WHERE id=?::uuid", id);
        assertThat(row.get("body")).isNull();
        assertThat(row.get("deleted_at")).isNotNull();
        assertThat(response(get("/v2/entries/{id}/comments", entry), 200).path("comments")).isEmpty();
        String reported = response(post("/v2/entries/{id}/comments", entry).content(comment("신고될 댓글")), 201).path("id").asText();
        response(post("/v2/reports").content(report("comment", reported, "inappropriate", null)), 201, token(author));
        JsonNode mine = response(get("/v2/entries/{id}/comments", entry), 200);
        assertThat(mine.at("/comments/0/status").asText()).isEqualTo("hidden");
        assertThat(mine.at("/comments/0/body").asText()).isEqualTo("신고될 댓글");
        assertThat(response(get("/v2/entries/{id}/comments", entry), 200, token(member("관객"))).path("comments")).isEmpty();
        response(delete("/v2/comments/{id}", reported), 204);
        assertThat(response(get("/v2/entries/{id}/comments", entry), 200).path("comments")).isEmpty();
    }

    @Test void challengeReact_withdrawnAuthorsKeepTheirCommentsUnderAPlaceholderName() throws Exception {
        UUID entry = entry(challenge, member("배우"));
        UUID leaving = member("떠날 사람");
        response(post("/v2/entries/{id}/comments", entry).content(comment("남는 댓글")), 201, token(leaving));
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", leaving);
        JsonNode comments = response(get("/v2/entries/{id}/comments", entry), 200);
        assertThat(comments.at("/comments/0/author/name").asText()).isEqualTo("탈퇴한 사용자");
        assertThat(comments.at("/comments/0/author_withdrawn").asBoolean()).isTrue();
        assertThat(comments.at("/comments/0/body").asText()).isEqualTo("남는 댓글");
    }

    @Test void challengeReact_crossingCommentsAndLikesBetweenTwoAuthorsNeverDeadlock() throws Exception {
        for (int round = 0; round < 8; round++) {
            UUID a = member("가 " + round), b = member("나 " + round);
            UUID ofA = entry(challenge, a), ofB = entry(challenge, b);
            String tokenA = token(a), tokenB = token(b);
            try (var executor = java.util.concurrent.Executors.newFixedThreadPool(4)) {
                var go = new java.util.concurrent.CountDownLatch(1);
                var calls = List.of(
                        executor.submit(() -> { go.await(); return raw(post("/v2/entries/{id}/comments", ofB).content(comment("a→b")), tokenA); }),
                        executor.submit(() -> { go.await(); return raw(put("/v2/entries/{id}/like", ofA), tokenB); }),
                        executor.submit(() -> { go.await(); return raw(post("/v2/entries/{id}/comments", ofA).content(comment("b→a")), tokenB); }),
                        executor.submit(() -> { go.await(); return raw(put("/v2/entries/{id}/like", ofB), tokenA); }));
                go.countDown();
                for (var call : calls) {
                    var response = call.get(30, java.util.concurrent.TimeUnit.SECONDS);
                    assertThat(response.getStatus()).as(response.getContentAsString()).isIn(200, 201);
                }
            }
        }
    }

    private org.springframework.mock.web.MockHttpServletResponse raw(MockHttpServletRequestBuilder request, String authorization)
            throws Exception {
        return mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/1.0.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
    }

    // ── challenge.block ────────────────────────────────────────────────────

    @Test void challengeBlock_hidesBothWaysKeepsOldLikesCountedAndIsIdempotent() throws Exception {
        UUID other = member("A");
        String otherToken = token(other);
        UUID theirs = entry(challenge, other);
        UUID mine = entry(challenge, me);
        response(put("/v2/entries/{id}/like", mine), 200, otherToken);
        response(post("/v2/entries/{id}/comments", mine).content(comment("A의 댓글")), 201, otherToken);
        response(put("/v2/entries/{id}/save", theirs), 200);
        response(put("/v2/me/blocks/{id}", other), 200);
        response(put("/v2/me/blocks/{id}", other), 200);
        assertThat(count("user_blocks")).isEqualTo(1);
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge), 200), "entries")).containsExactly(mine.toString());
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge), 200, otherToken), "entries"))
                .containsExactly(theirs.toString());
        assertThat(response(get("/v2/me/saved-entries"), 200).path("entries")).isEmpty();
        assertThat(response(get("/v2/entries/{id}/comments", mine), 200).path("comments")).isEmpty();
        assertThat(response(get("/v2/entries/{id}", mine), 200).path("like_count").asInt()).isEqualTo(1);
        assertThat(detail(delete("/v2/entries/{id}/like", mine), 404, otherToken)).isEqualTo("entry_not_found");
        assertThat(detail(post("/v2/entries/{id}/comments", theirs).content(comment("못 씀")), 404)).isEqualTo("entry_not_found");
        JsonNode list = response(get("/v2/me/blocks"), 200);
        assertThat(list.at("/users/0/name").asText()).isEqualTo("A");
        assertThat(list.at("/users/0").has("photo_url")).isFalse();
        assertThat(response(get("/v2/me/blocks"), 200, otherToken).path("users")).isEmpty();
        response(delete("/v2/me/blocks/{id}", other), 200);
        response(delete("/v2/me/blocks/{id}", other), 200);
        assertThat(ids(response(get("/v2/challenges/{id}/entries", challenge), 200), "entries")).hasSize(2);
        assertThat(detail(put("/v2/me/blocks/{id}", me), 422)).isEqualTo("self_block");
        assertThat(detail(put("/v2/me/blocks/{id}", UUID.randomUUID()), 404)).isEqualTo("user_not_found");
    }

    // ── challenge.report ───────────────────────────────────────────────────

    @Test void challengeReport_anEntryReportHidesItAtOnceAndTheAuthorSeesUnderReview() throws Exception {
        UUID author = member("배우");
        UUID entry = entry(challenge, author);
        jdbc.update("UPDATE challenge_entries SET content_version=2,caption='수정한 캡션' WHERE id=?", entry);
        JsonNode receipt = response(post("/v2/reports").content(report("entry", entry.toString(), "inappropriate", null)), 201);
        assertThat(receipt.path("status").asText()).isEqualTo("received");
        var row = jdbc.queryForMap("SELECT status,target_version,target_text FROM entry_reports WHERE id=?::uuid", receipt.path("id").asText());
        assertThat(row).containsEntry("status", "received").containsEntry("target_version", 2).containsEntry("target_text", "수정한 캡션");
        assertThat(jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("hidden_by_report");
        assertThat(response(get("/v2/challenges/{id}/entries", challenge), 200, token(member("관객"))).path("entries")).isEmpty();
        JsonNode record = response(get("/v2/me/challenge-entries"), 200, token(author));
        assertThat(record.path("counts").path("under_review").asInt()).isEqualTo(1);
        assertThat(response(post("/v2/reports").content(report("entry", entry.toString(), "spam", null)), 200).path("id"))
                .isEqualTo(receipt.path("id"));
        assertThat(detail(post("/v2/reports").content(report("entry", entry.toString(), "spam", null)), 404, token(member("다른 신고자"))))
                .isEqualTo("entry_not_found");
        assertThat(count("entry_reports")).isEqualTo(1);
        String sameRequest = report("entry", entry.toString(), "spam", null);
        UUID other = entry(challenge, member("다른 배우"));
        response(post("/v2/reports").content(sameRequest.replace(entry.toString(), other.toString())), 201, token(member("재전송")));
        assertThat(detail(post("/v2/reports").content(report("challenge", UUID.randomUUID().toString(), "spam", null)), 404))
                .isEqualTo("challenge_not_found");
        assertThat(detail(post("/v2/reports").content(report("comment", UUID.randomUUID().toString(), "spam", null)), 404))
                .isEqualTo("comment_not_found");
        assertThat(detail(patch("/v2/admin/reports/{id}", UUID.randomUUID()).content(resolution("restored")), 404, OPS))
                .isEqualTo("report_not_found");
    }

    @Test void challengeReport_sameRequestIdWithAnotherBodyIsRejected() throws Exception {
        UUID request = UUID.randomUUID();
        UUID first = entry(challenge, member("첫째"));
        UUID second = entry(challenge, member("둘째"));
        String body = json.writeValueAsString(Map.of("request_id", request, "target_type", "entry", "target_id", first, "reason", "spam"));
        response(post("/v2/reports").content(body), 201);
        assertThat(detail(post("/v2/reports").content(body.replace(first.toString(), second.toString())), 422))
                .isEqualTo("request_fingerprint_mismatch");
    }

    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;

    @Test void challengeReact_withdrawalBeforeTheWritePreventsALateLike() throws Exception {
        UUID entry = entry(challenge, member("배우"));
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var late = transaction.execute(status -> {
                int locker = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, me);
                var request = executor.submit(() -> mvc.perform(put("/v2/entries/{id}/like", entry).header("Authorization", bearer)
                        .header("X-Acttub-Client", "app/1.0.0").header("Accept-Language", "ko")).andReturn().getResponse());
                org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).until(() ->
                        jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid)))",
                                Boolean.class, locker));
                jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", me);
                return request;
            }).get(20, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(late.getStatus()).isEqualTo(403);
            assertThat(json.readTree(late.getContentAsString()).path("detail").asText()).isEqualTo("account_deactivated");
        }
        assertThat(count("entry_likes")).isZero();
    }

    @Test void challengeReport_challengesGoToReviewOnlyAtThreeOpenReportsFromDifferentPeople() throws Exception {
        for (int i = 0; i < 2; i++) {
            response(post("/v2/reports").content(report("challenge", challenge.toString(), "spam", null)), 201, token(member("신고 " + i)));
        }
        assertThat(moderation(challenge)).isEqualTo("visible");
        response(post("/v2/reports").content(report("challenge", challenge.toString(), "other", "대사가 부적절")), 201);
        assertThat(moderation(challenge)).isEqualTo("review");
        String any = jdbc.queryForObject("SELECT CAST(id AS text) FROM entry_reports WHERE target_id=? LIMIT 1", String.class, challenge);
        resolve(any, "kept_hidden", 200);
        assertThat(moderation(challenge)).isEqualTo("review");
        assertThat(response(get("/v2/challenges"), 200).path("challenges")).isEmpty();

        UUID another = challenge(NOW.plus(Duration.ofDays(7)));
        var reports = new ArrayList<String>();
        for (int i = 0; i < 2; i++) {
            reports.add(response(post("/v2/reports").content(report("challenge", another.toString(), "spam", null)), 201,
                    token(member("처리될 " + i))).path("id").asText());
        }
        for (String id : reports) resolve(id, "dismissed", 200);
        response(post("/v2/reports").content(report("challenge", another.toString(), "spam", null)), 201);
        assertThat(moderation(another)).isEqualTo("visible");
    }

    @Test void challengeReport_selfReportsDailyLimitAndNoteLength() throws Exception {
        UUID mine = entry(challenge, me);
        assertThat(detail(post("/v2/reports").content(report("entry", mine.toString(), "spam", null)), 422)).isEqualTo("self_report");
        response(post("/v2/reports").content(report("entry", entry(challenge, member("x")).toString(), "other", "가".repeat(201))), 422);
        response(post("/v2/reports").content(report("entry", entry(challenge, member("y")).toString(), "other", "가".repeat(200))), 201);
        response(post("/v2/reports").content(report("entry", entry(challenge, member("z")).toString(), "rude", null)), 422);
        for (int i = 1; i < 20; i++) {
            response(post("/v2/reports").content(report("entry", entry(challenge, member("대상 " + i)).toString(), "spam", null)), 201);
        }
        assertThat(detail(post("/v2/reports").content(report("entry", entry(challenge, member("21")).toString(), "spam", null)), 429))
                .isEqualTo("daily_report_limit");
    }

    @Test void challengeReport_resolutionsReleaseOnlyWhenNoOpenReportRemainsAndKeepTheAuthorsChoices() throws Exception {
        UUID author = member("배우");
        UUID entry = entry(challenge, author);
        String first = response(post("/v2/reports").content(report("entry", entry.toString(), "spam", null)), 201,
                token(member("첫 신고자"))).path("id").asText();
        String secondReporter = token(member("둘째 신고자"));
        jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,target_version,request_id,request_fingerprint)
                VALUES (?,'entry',?,?,'spam',1,?,?)
                """, UUID.randomUUID(), entry, member("동시 신고자"), UUID.randomUUID(), "0".repeat(64));
        JsonNode stillOpen = resolve(first, "restored", 200);
        assertThat(stillOpen.path("status").asText()).isEqualTo("reviewed");
        assertThat(stillOpen.path("reviewed_by").asText()).isEqualTo("운영");
        assertThat(stillOpen.path("reviewed_at").isNull()).isFalse();
        assertThat(jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("hidden_by_report");
        assertThat(detail(patch("/v2/admin/reports/{id}", first).content(resolution("dismissed")), 422, OPS))
                .isEqualTo("report_already_reviewed");
        JsonNode queue = response(get("/v2/admin/reports"), 200, OPS);
        String open = queue.at("/reports/0/id").asText();
        assertThat(queue.at("/reports/0/open_reports").asInt()).isEqualTo(1);
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", entry);
        resolve(open, "dismissed", 200);
        var row = jdbc.queryForMap("SELECT status,visibility FROM challenge_entries WHERE id=?", entry);
        assertThat(row).containsEntry("status", "visible").containsEntry("visibility", "private");
        jdbc.update("UPDATE challenge_entries SET visibility='public' WHERE id=?", entry);
        response(post("/v2/reports").content(report("entry", entry.toString(), "spam", null)), 200, token(UUID.fromString(
                jdbc.queryForObject("SELECT reporter_id FROM entry_reports WHERE id=?::uuid", String.class, first))));
        assertThat(jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("visible");
        String again = response(post("/v2/reports").content(report("entry", entry.toString(), "copyright", null)), 201, secondReporter)
                .path("id").asText();
        assertThat(jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("hidden_by_report");
        jdbc.update("UPDATE challenge_entries SET caption='나중 캡션',content_version=content_version+1 WHERE id=?", entry);
        JsonNode kept = resolve(again, "kept_hidden", 200);
        assertThat(kept.path("target_version").asInt()).isEqualTo(1);
        assertThat(kept.path("current_version").asInt()).isEqualTo(2);
        assertThat(kept.path("current_text").asText()).isEqualTo("나중 캡션");
        assertThat(kept.path("target_state").asText()).isEqualTo("hidden_by_report");
        assertThat(jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("hidden_by_report");
        assertThat(kept.has("reporter_id")).isFalse();
    }

    @Test void challengeReport_reportsOutliveDeletionAndReviewedOnesExpireAfterNinetyDays() throws Exception {
        UUID author = member("배우");
        UUID entry = entry(challenge, author);
        String id = response(post("/v2/reports").content(report("entry", entry.toString(), "spam", null)), 201).path("id").asText();
        response(delete("/v2/entries/{id}", entry), 204, token(author));
        assertThat(jdbc.queryForObject("SELECT target_text IS NULL FROM entry_reports WHERE id=?::uuid", Boolean.class, id)).isTrue();
        JsonNode reviewed = resolve(id, "kept_hidden", 200);
        assertThat(reviewed.path("target_state").asText()).isEqualTo("deleted");
        clock.advance(Duration.ofDays(91));
        entryRepository.settle(clock.instant());
        assertThat(count("entry_reports")).isZero();
    }

    @Test void challengeReport_keptHiddenEntriesAreLeftOutWhenTheFinalRankingIsConfirmed() throws Exception {
        Instant deadline = NOW.plus(Duration.ofHours(1));
        UUID ending = challenge(deadline);
        UUID hidden = entry(ending, member("가려질"));
        UUID shown = entry(ending, member("남을"));
        for (int i = 0; i < 3; i++) response(put("/v2/entries/{id}/like", hidden), 200, token(member("팬 " + i)));
        String id = response(post("/v2/reports").content(report("entry", hidden.toString(), "spam", null)), 201).path("id").asText();
        clock.set(deadline.plus(Duration.ofMinutes(1)));
        entryRepository.settle(clock.instant());
        assertThat(jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, ending)).isEqualTo("pending");
        resolve(id, "kept_hidden", 200);
        assertThat(jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, ending)).isEqualTo("final");
        assertThat(jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, shown)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, hidden)).isNull();
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

    /** 공개 참여작 하나. */
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

    private String report(String type, String target, String reason, String note) throws Exception {
        var body = new HashMap<String, Object>(Map.of("request_id", UUID.randomUUID(), "target_type", type, "target_id", target,
                "reason", reason));
        if (note != null) body.put("note", note);
        return json.writeValueAsString(body);
    }

    private String resolution(String value) throws Exception {
        return json.writeValueAsString(Map.of("resolution", value, "reviewer", "운영"));
    }

    private JsonNode resolve(String id, String value, int status) throws Exception {
        return response(patch("/v2/admin/reports/{id}", id).content(resolution(value)), status, OPS);
    }

    private String moderation(UUID id) { return jdbc.queryForObject("SELECT moderation FROM challenges WHERE id=?", String.class, id); }

    private int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }

    private static List<String> ids(JsonNode page, String field) {
        var ids = new ArrayList<String>();
        page.path(field).forEach(item -> ids.add(item.path("id").asText()));
        return ids;
    }

    private String detail(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected).path("detail").asText();
    }

    private String detail(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        return response(request, expected, authorization).path("detail").asText();
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
