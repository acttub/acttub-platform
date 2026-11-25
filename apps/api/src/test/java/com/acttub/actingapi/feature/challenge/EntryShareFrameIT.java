package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryShareFrames;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.platform.json.LenientJson;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 공유 프레임 (challenge.entry 공유 프레임, SOMA-1156). 실제 HTTP 와 Postgres 를 쓰고 영상 합성과 저장소 주소만 대체한다 —
 * 본인 참여작에만 만들고, 만든 키를 참여작에 적어 다음부터 바로 내주며, 삭제·모자이크 변경·파일 파기 때 정리 장부로 보내는지 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret"})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, EntryShareFrameIT.Media.class})
class EntryShareFrameIT {
    static final Instant NOW = Instant.parse("2026-11-25T03:00:00Z");

    @TestConfiguration
    static class Media {
        /** 만든 것: "video|sourceKey|targetKey|frame" 또는 "preview|…". */
        static final List<String> RENDERED = new CopyOnWriteArrayList<>();
        static volatile boolean FAIL;

        @Bean @Primary EntryMedia stubShareFrameMedia() {
            return new EntryMedia() {
                @Override public int durationMs(String objectKey) { return 30_000; }
                @Override public String playbackUrl(String objectKey) { return "https://play.test/" + objectKey; }
            };
        }

        @Bean @Primary EntryShareFrames stubShareFrames() {
            return new EntryShareFrames() {
                @Override public void requireConfigured() { }
                @Override public void renderVideo(ShareFrames.Card card, String sourceKey, String targetKey) {
                    if (FAIL) throw new IllegalStateException("render failed");
                    RENDERED.add("video|" + sourceKey + "|" + targetKey + "|" + card.frame().id() + "|" + card.name() + "|"
                            + card.date() + "|" + card.number());
                }
                @Override public void renderPreview(ShareFrames.Card card, String sourceKey, String targetKey) {
                    RENDERED.add("preview|" + sourceKey + "|" + targetKey);
                }
            };
        }
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
        Media.RENDERED.clear();
        Media.FAIL = false;
        jdbc.execute("TRUNCATE users,challenges,upload_intents RESTART IDENTITY CASCADE");
        user = member("WooYoung");
        bearer = token(user);
    }

    @Test void theOwnerGetsAFramedVideoOnceAndThenStraightFromItsKey() throws Exception {
        UUID challenge = challenge(NOW.minus(Duration.ofDays(1)));
        UUID video = video(user);
        String entry = enter(challenge, video);
        String key = "videos/" + video + ".frame-" + entry + "-white-original-v" + ShareFrames.VERSION + ".mp4";

        JsonNode first = response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 202);
        assertThat(LenientJson.asText(first.path("status"))).isEqualTo("rendering");
        assertThat(first.path("video_url").isNull()).isTrue();
        JsonNode ready = awaitReady(entry, "white");
        assertThat(LenientJson.asText(ready.path("video_url"))).isEqualTo("https://play.test/" + key);
        assertThat(Media.RENDERED).containsExactly("video|videos/" + video + "|" + key + "|white|WooYoung|2026.11.25|1");
        assertThat(frameKeys(entry)).containsExactly(key);

        // 다시 요청해도 다시 만들지 않는다.
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 200);
        assertThat(Media.RENDERED).hasSize(1);

        JsonNode preview = response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "blue"), 200);
        String previewKey = "videos/" + video + ".frame-" + entry + "-blue-original-v" + ShareFrames.VERSION + ".jpg";
        assertThat(LenientJson.asText(preview.path("image_url"))).isEqualTo("https://play.test/" + previewKey);
        response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "blue"), 200);
        response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "none"), 200);
        assertThat(Media.RENDERED).filteredOn(line -> line.startsWith("preview|")).hasSize(2);
        assertThat(frameKeys(entry)).contains(key, previewKey);
    }

    @Test void theChallengeNumberCountsChallengesOfTheSameOriginByStart() throws Exception {
        challenge(NOW.minus(Duration.ofDays(20)));
        challenge(NOW.minus(Duration.ofDays(10)));
        UUID third = challenge(NOW.minus(Duration.ofDays(1)));
        String entry = enter(third, video(user));
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"black\"}"), 202);
        awaitReady(entry, "black");
        assertThat(Media.RENDERED.getFirst()).endsWith("|3");
    }

    @Test void aFailedRenderIsToldOnceAndTheNextRequestTriesAgain() throws Exception {
        String entry = enter(challenge(NOW.minus(Duration.ofDays(1))), video(user));
        Media.FAIL = true;
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"blue\"}"), 202);
        Awaitility.await().atMost(Duration.ofSeconds(10)).until(() -> {
            JsonNode body = json.readTree(raw(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"blue\"}"))
                    .getContentAsString());
            return "failed".equals(LenientJson.asText(body.path("status")));
        });
        Media.FAIL = false;
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"blue\"}"), 202);
        awaitReady(entry, "blue");
    }

    @Test void onlyTheOwnersLiveEntryWithAFileCanBeFramed() throws Exception {
        UUID challenge = challenge(NOW.minus(Duration.ofDays(1)));
        String entry = enter(challenge, video(user));
        String other = token(member("다른 배우"));
        assertThat(LenientJson.asText(response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 404, other)
                .path("detail"))).isEqualTo("entry_not_found");
        assertThat(LenientJson.asText(response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "white"), 404, other)
                .path("detail"))).isEqualTo("entry_not_found");
        response(post("/v2/entries/{id}/share-frames", UUID.randomUUID()).content("{\"frame\":\"white\"}"), 404);

        assertThat(response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"red\"}"), 422).path("detail").isArray())
                .isTrue();
        assertThat(response(post("/v2/entries/{id}/share-frames", entry).content("{}"), 422).path("detail").isArray()).isTrue();
        assertThat(response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "red"), 422).path("detail").isArray())
                .isTrue();

        String purged = enter(challenge, video(user));
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?::uuid)", purged);
        assertThat(LenientJson.asText(response(post("/v2/entries/{id}/share-frames", purged).content("{\"frame\":\"white\"}"), 422)
                .path("detail"))).isEqualTo("video_not_ready");

        response(delete("/v2/entries/{id}", entry), 204);
        assertThat(LenientJson.asText(response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 404)
                .path("detail"))).isEqualTo("entry_not_found");
        assertThat(Media.RENDERED).isEmpty();
    }

    @Test void aReadyMosaicIsWhatGetsFramedAndChangingTheMosaicDropsTheMadeFrames() throws Exception {
        UUID video = video(user);
        String entry = enter(challenge(NOW.minus(Duration.ofDays(1))), video);
        String original = "videos/" + video + ".frame-" + entry + "-white-original-v" + ShareFrames.VERSION + ".mp4";
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 202);
        awaitReady(entry, "white");
        assertThat(frameKeys(entry)).containsExactly(original);

        // 모자이크를 켜면 원본에 씌운 것은 정리 장부로 간다.
        int ledger = ledgerRows();
        response(patch("/v2/entries/{id}", entry).content("{\"face_mosaic\":true}"), 200);
        assertThat(frameKeys(entry)).isEmpty();
        assertThat(ledgerRows()).isEqualTo(ledger + 1);

        // 모자이크본이 아직 없으면 원본에 씌우지 않는다. 「없음」 미리보기는 지금처럼 된다.
        assertThat(LenientJson.asText(response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 422)
                .path("detail"))).isEqualTo("mosaic_not_ready");
        assertThat(LenientJson.asText(response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "blue"), 422)
                .path("detail"))).isEqualTo("mosaic_not_ready");
        response(get("/v2/entries/{id}/share-frames/{frame}/preview", entry, "none"), 200);
        jdbc.update("UPDATE challenge_entries SET share_frame_keys='{}' WHERE id=?::uuid", entry);

        String mosaic = "videos/" + video + ".mosaic-" + entry + ".mp4";
        jdbc.update("UPDATE challenge_entries SET mosaic_status='ready',mosaic_key=? WHERE id=?::uuid", mosaic, entry);
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"white\"}"), 202);
        awaitReady(entry, "white");
        String framedMosaic = "videos/" + video + ".frame-" + entry + "-white-mosaic-v" + ShareFrames.VERSION + ".mp4";
        assertThat(Media.RENDERED.getLast()).startsWith("video|" + mosaic + "|" + framedMosaic);
        assertThat(frameKeys(entry)).containsExactly(framedMosaic);
    }

    @Test void deletingTheEntryOrPurgingTheFileSendsTheMadeFramesToTheLedger() throws Exception {
        UUID challenge = challenge(NOW.minus(Duration.ofDays(1)));
        String entry = enter(challenge, video(user));
        response(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"blue\"}"), 202);
        awaitReady(entry, "blue");
        int ledger = ledgerRows();
        response(delete("/v2/entries/{id}", entry), 204);
        assertThat(frameKeys(entry)).isEmpty();
        // 모자이크본이 없으니 늘어난 장부 행은 프레임 정리 하나다.
        assertThat(ledgerRows()).isEqualTo(ledger + 1);

        // 파일만 파기: 원본·모자이크본과 함께 프레임 키를 모으는 문장이 돈다(장부 본문은 암호화돼 키는 여기서 보지 않는다).
        UUID purgedVideo = video(user);
        String kept = enter(challenge, purgedVideo);
        response(post("/v2/entries/{id}/share-frames", kept).content("{\"frame\":\"black\"}"), 202);
        awaitReady(kept, "black");
        int before = ledgerRows();
        response(post("/v2/videos/{id}/purge-file", purgedVideo), 200);
        assertThat(ledgerRows()).isEqualTo(before + 1);
        assertThat(LenientJson.asText(response(post("/v2/entries/{id}/share-frames", kept).content("{\"frame\":\"black\"}"), 422)
                .path("detail"))).isEqualTo("video_not_ready");
    }

    @Test void aLateRenderForADeletedEntryIsNotAttached() throws Exception {
        UUID video = video(user);
        String entry = enter(challenge(NOW.minus(Duration.ofDays(1))), video);
        var source = entryRepository.shareFrameSource(user, UUID.fromString(entry));
        response(delete("/v2/entries/{id}", entry), 204);
        String key = "videos/" + video + ".frame-" + entry + "-white-original-v" + ShareFrames.VERSION + ".mp4";
        assertThat(entryRepository.attachShareFrame(source, key, NOW)).hasSize(1);
        assertThat(frameKeys(entry)).isEmpty();
    }

    private JsonNode awaitReady(String entry, String frame) throws Exception {
        JsonNode[] last = new JsonNode[1];
        Awaitility.await().atMost(Duration.ofSeconds(10)).until(() -> {
            var response = raw(post("/v2/entries/{id}/share-frames", entry).content("{\"frame\":\"" + frame + "\"}"));
            last[0] = json.readTree(response.getContentAsString());
            return response.getStatus() == 200 && "ready".equals(LenientJson.asText(last[0].path("status")));
        });
        return last[0];
    }

    private List<String> frameKeys(String entry) {
        String joined = jdbc.queryForObject("SELECT array_to_string(share_frame_keys,',') FROM challenge_entries WHERE id=?::uuid",
                String.class, entry);
        return joined == null || joined.isEmpty() ? List.of() : List.of(joined.split(","));
    }

    private int ledgerRows() {
        return jdbc.queryForObject("SELECT count(*) FROM account_cleanup_operations WHERE kind='object_delete'", Integer.class);
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

    private UUID challenge(Instant startsAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,'괜찮아, 진짜 괜찮다니까.','창작',7,'team',?,?,?,?)
                """, id, UUID.randomUUID(), "0".repeat(64), java.sql.Timestamp.from(startsAt),
                java.sql.Timestamp.from(NOW.plus(Duration.ofDays(7))));
        return id;
    }

    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                id, owner, "videos/" + id);
        return id;
    }

    private String enter(UUID challenge, UUID video) throws Exception {
        return LenientJson.asText(response(post("/v2/challenges/{id}/entries", challenge).content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "video_id", video, "visibility", "public"))), 201).path("id"));
    }

    private org.springframework.mock.web.MockHttpServletResponse raw(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", bearer).header("X-Acttub-Client", "app/0.1.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected, bearer);
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        var result = mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/0.1.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn();
        var response = result.getResponse();
        assertThat(response.getStatus()).as("%s (%s)", response.getContentAsString(), result.getResolvedException()).isEqualTo(expected);
        return response.getContentAsString().isBlank() ? json.nullNode() : json.readTree(response.getContentAsString());
    }
}
