package com.acttub.actingapi.feature.portfolio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * account.portfolio 의 "검증 방법"을 HTTP 와 실제 Postgres 로 본다. 오브젝트 스토리지는 메모리의 가짜다 —
 * "사진 객체가 없다"는 그 상태로 확인한다. 앱이 30MB 사진을 줄여서 올리는 것과 웹 페이지의 noindex 메타는
 * 각 갈래가 본다(서버는 응답 헤더 {@code X-Robots-Tag} 를 싣는다).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "SITE_URL=https://acttub.test/"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, AccountPortfolioIT.StorageFixture.class})
class AccountPortfolioIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_portfolio");
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

    @Autowired
    MutableClock clock;

    @Autowired
    FakeStorage storage;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        storage.objects.clear();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("account.portfolio: 한 번도 편집하지 않은 회원의 포트폴리오는 빈 모양으로 200 이고 행이 없다. 처음 저장할 때 행이 생긴다")
    void accountPortfolio_startsEmptyAndIsCreatedByTheFirstSave() throws Exception {
        JsonNode empty = json(get("/v2/portfolio"), 200);

        assertThat(empty).isEqualTo(mapper.readTree("""
                {"intro":null,"credits":[],"photos":[],"share":{"enabled":false,"slug":null,"url":null}}
                """));
        assertThat(count("portfolios")).isZero();

        JsonNode saved = json(put("/v2/portfolio/intro").content("{\"intro\":\"  무대와 카메라를 오갑니다.\\n둘째 줄  \"}"), 200);

        assertThat(saved.path("intro").textValue()).isEqualTo("무대와 카메라를 오갑니다.\n둘째 줄");
        assertThat(count("portfolios")).isEqualTo(1);
        assertThat(json(put("/v2/portfolio/intro").content("{\"intro\":null}"), 200).path("intro").isNull()).isTrue();
    }

    @Test
    @DisplayName("account.portfolio: 경력 둘과 사진 셋을 저장하고 다시 열면 그대로 보인다. 순서를 바꿔 저장하면 순서가 유지된다")
    void accountPortfolio_creditsAndPhotosKeepTheirOrder() throws Exception {
        String film = addCredit("영화 하나", "주연", 2025, "film").path("id").textValue();
        String play = addCredit("연극 둘", "앙상블", 2024, "play").path("id").textValue();
        List<String> photos = List.of(uploadPhoto(), uploadPhoto(), uploadPhoto());

        JsonNode reopened = json(get("/v2/portfolio"), 200);
        assertThat(ids(reopened.path("credits"))).containsExactly(film, play);
        assertThat(ids(reopened.path("photos"))).containsExactlyElementsOf(photos);
        assertThat(reopened.path("credits").get(0)).isEqualTo(mapper.readTree(
                "{\"id\":\"" + film + "\",\"title\":\"영화 하나\",\"role\":\"주연\",\"year\":2025,\"kind\":\"film\"}"));
        assertThat(reopened.path("photos").get(0).path("url").textValue()).startsWith("https://storage.test/get/");

        JsonNode reordered = json(put("/v2/portfolio/credits/order")
                .content(mapper.writeValueAsString(Map.of("ids", List.of(play, film)))), 200);
        assertThat(ids(reordered.path("credits"))).containsExactly(play, film);
        json(put("/v2/portfolio/photos/order").content(mapper.writeValueAsString(
                Map.of("ids", List.of(photos.get(2), photos.get(0), photos.get(1))))), 200);

        JsonNode again = json(get("/v2/portfolio"), 200);
        assertThat(ids(again.path("credits"))).containsExactly(play, film);
        assertThat(ids(again.path("photos"))).containsExactly(photos.get(2), photos.get(0), photos.get(1));

        JsonNode patched = json(patch("/v2/portfolio/credits/{id}", film).content("{\"role\":\"조연\"}"), 200);
        assertThat(patched.path("role").textValue()).isEqualTo("조연");
        assertThat(patched.path("title").textValue()).as("보낸 항목만 바꾼다").isEqualTo("영화 하나");
    }

    @Test
    @DisplayName("account.portfolio: 순서 바꾸기에 보낸 목록이 지금 목록과 다르면 422 order_mismatch 이고 순서는 그대로다")
    void accountPortfolio_orderMustNameExactlyTheCurrentItems() throws Exception {
        String first = addCredit("하나", "역", 2020, "drama").path("id").textValue();
        String second = addCredit("둘", "역", 2021, "drama").path("id").textValue();

        for (List<String> ids : List.of(
                List.of(first), List.of(first, first), List.of(first, second, UUID.randomUUID().toString()))) {
            JsonNode error = json(put("/v2/portfolio/credits/order")
                    .content(mapper.writeValueAsString(Map.of("ids", ids))), 422);
            assertThat(error).isEqualTo(mapper.readTree("{\"detail\":\"order_mismatch\"}"));
        }
        assertThat(json(put("/v2/portfolio/photos/order")
                .content(mapper.writeValueAsString(Map.of("ids", List.of(UUID.randomUUID().toString())))), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"order_mismatch\"}"));
        assertThat(ids(json(get("/v2/portfolio"), 200).path("credits"))).containsExactly(first, second);
    }

    @Test
    @DisplayName("account.portfolio: 링크를 켜고 주소를 열면 이름·프로필 사진·성별·만 나이·소개글·경력·사진이 보이고 연습·분석은 없다. 응답에 noindex 가 실린다")
    void accountPortfolio_publicPageShowsTheProfileAndThePortfolioOnly() throws Exception {
        jdbc.update("UPDATE user_profiles SET name='김배우',gender='female',birth_date=?,photo_key='users/p/profile.jpg' WHERE user_id=?",
                java.sql.Date.valueOf(today().minusYears(25)), member);
        json(put("/v2/portfolio/intro").content("{\"intro\":\"소개글\"}"), 200);
        addCredit("영화 하나", "주연", 2025, "film");
        uploadPhoto();

        JsonNode share = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200);

        String slug = share.path("slug").textValue();
        assertThat(slug).as("추측할 수 없는 난수이고 '/'·'+'·'=' 가 없다").matches("[A-Za-z0-9_-]{22}");
        assertThat(share.path("enabled").booleanValue()).isTrue();
        assertThat(share.path("url").textValue()).isEqualTo("https://acttub.test/p/" + slug);

        var response = visit(slug);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("X-Robots-Tag")).contains("noindex");
        JsonNode page = mapper.readTree(response.getContentAsString());
        assertThat(page.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "name", "photo_url", "gender", "age", "intro", "credits", "photos");
        assertThat(page.path("name").textValue()).isEqualTo("김배우");
        assertThat(page.path("photo_url").textValue()).isEqualTo("https://storage.test/get/users/p/profile.jpg");
        assertThat(page.path("gender").textValue()).isEqualTo("female");
        assertThat(page.path("age").intValue()).isEqualTo(25);
        assertThat(page.path("intro").textValue()).isEqualTo("소개글");
        assertThat(page.path("credits")).hasSize(1);
        assertThat(page.path("credits").get(0).fieldNames()).toIterable()
                .containsExactlyInAnyOrder("title", "role", "year", "kind");
        assertThat(page.path("photos")).hasSize(1);
        assertThat(page.path("photos").get(0).fieldNames()).toIterable().containsExactly("url");

        // 링크를 켠 채 프로필의 이름을 바꾸면 공개 페이지도 바뀐다.
        jdbc.update("UPDATE user_profiles SET name='새 이름' WHERE user_id=?", member);
        assertThat(mapper.readTree(visit(slug).getContentAsString()).path("name").textValue()).isEqualTo("새 이름");
    }

    @Test
    @DisplayName("account.portfolio: 링크를 끄고 같은 주소 — 404. 다시 켜면 같은 주소가 열린다. 없는 slug 도 같은 404 다")
    void accountPortfolio_turningTheLinkOffAndOnKeepsTheAddress() throws Exception {
        String slug = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200).path("slug").textValue();

        JsonNode off = json(put("/v2/portfolio/share").content("{\"enabled\":false}"), 200);
        assertThat(off.path("enabled").booleanValue()).isFalse();
        assertThat(off.path("slug").textValue()).as("꺼도 slug 는 남는다").isEqualTo(slug);

        var closed = visit(slug);
        var unknown = visit("no-such-slug");
        for (var response : List.of(closed, unknown)) {
            assertThat(response.getStatus()).isEqualTo(404);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"portfolio_not_found\"}"));
        }

        JsonNode on = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200);
        assertThat(on.path("slug").textValue()).isEqualTo(slug);
        assertThat(json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200).path("slug").textValue())
                .as("같은 값을 다시 보내도 같은 결과다").isEqualTo(slug);
        assertThat(visit(slug).getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.portfolio: 링크를 켠 상태에서 탈퇴 — 같은 주소가 404 이고 portfolios·portfolio_credits·portfolio_photos 행과 사진 객체가 없다")
    void accountPortfolio_withdrawalRemovesThePortfolioAndItsPhotos() throws Exception {
        addCredit("영화 하나", "주연", 2025, "film");
        uploadPhoto();
        uploadPhoto();
        String slug = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200).path("slug").textValue();
        assertThat(storage.objects).hasSize(2);

        assertThat(mvc.perform(delete("/v2/me").header("Authorization", bearer)).andReturn().getResponse().getStatus())
                .isEqualTo(200);

        assertThat(visit(slug).getStatus()).isEqualTo(404);
        assertThat(count("portfolios")).isZero();
        assertThat(count("portfolio_credits")).isZero();
        assertThat(count("portfolio_photos")).isZero();
        assertThat(storage.objects).as("사진 객체도 지운다").isEmpty();
    }

    @Test
    @DisplayName("account.portfolio: 열한 번째 사진 추가 — 422. 아직 끝나지 않은 올리기도 장수에 센다")
    void accountPortfolio_theEleventhPhotoIsRejected() throws Exception {
        for (int photo = 0; photo < 9; photo++) {
            uploadPhoto();
        }
        beginPhoto("image/jpeg", 1000, 201);

        JsonNode eleventh = beginPhoto("image/jpeg", 1000, 422);

        assertThat(eleventh).isEqualTo(mapper.readTree("{\"detail\":\"portfolio_photo_limit_exceeded\"}"));
        assertThat(count("portfolio_photos")).isEqualTo(10);

        // 시한(30분)이 지난 올리기는 세지 않는다.
        clock.advance(java.time.Duration.ofMinutes(31));
        assertThat(beginPhoto("image/jpeg", 1000, 201).path("photo_id").textValue()).isNotBlank();
    }

    @Test
    @DisplayName("account.portfolio: 앱을 거치지 않고 11MB 로 올리기를 요청하면 413, 이미지가 아니면 415 — 프로필 사진과 같은 안전망이다")
    void accountPortfolio_photoUploadSafetyNet() throws Exception {
        assertThat(beginPhoto("image/jpeg", 11L * 1024 * 1024, 413))
                .isEqualTo(mapper.readTree("{\"detail\":\"upload_too_large\"}"));
        assertThat(beginPhoto("video/mp4", 1000, 415))
                .isEqualTo(mapper.readTree("{\"detail\":\"unsupported_media_type\"}"));
        assertThat(beginPhoto("image/heic", 10L * 1024 * 1024, 201).path("upload_url").textValue())
                .startsWith("https://storage.test/put/users/" + member + "/portfolio/");
        assertThat(count("portfolio_photos")).isEqualTo(1);
    }

    @Test
    @DisplayName("account.portfolio: 사진 올리기 끝 — 올린 객체가 없거나 크기가 다르면 409 이고, 없는 photo_id 는 404 다")
    void accountPortfolio_completingAnUploadChecksTheObject() throws Exception {
        JsonNode intent = beginPhoto("image/jpeg", 1000, 201);
        String photoId = intent.path("photo_id").textValue();
        String objectKey = jdbc.queryForObject("SELECT object_key FROM portfolio_photos", String.class);

        assertThat(json(post("/v2/portfolio/photos/{id}/complete", photoId), 409).path("detail").textValue())
                .isEqualTo("upload_not_found");
        storage.objects.put(objectKey, 999L);
        assertThat(json(post("/v2/portfolio/photos/{id}/complete", photoId), 409).path("detail").textValue())
                .isEqualTo("upload_size_mismatch");
        assertThat(json(post("/v2/portfolio/photos/{id}/complete", UUID.randomUUID()), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"portfolio_photo_not_found\"}"));

        storage.objects.put(objectKey, 1000L);
        JsonNode done = json(post("/v2/portfolio/photos/{id}/complete", photoId), 200);
        assertThat(ids(done.path("photos"))).containsExactly(photoId);
        assertThat(ids(json(post("/v2/portfolio/photos/{id}/complete", photoId), 200).path("photos")))
                .as("응답을 못 받은 앱이 다시 불러도 같은 결과다").containsExactly(photoId);
    }

    @Test
    @DisplayName("account.portfolio: 같은 경력을 두 번 지우면 두 번째는 404 다. 사진도 같고, 남의 것도 같은 404 다")
    void accountPortfolio_deletingTwiceIsNotFound() throws Exception {
        String credit = addCredit("영화 하나", "주연", 2025, "film").path("id").textValue();
        String photo = uploadPhoto();
        UUID other = member();
        String others = "Bearer " + jwt.issueAccessToken(other).value();

        assertThat(perform(delete("/v2/portfolio/credits/{id}", credit), others).getStatus())
                .as("남의 경력").isEqualTo(404);
        assertThat(perform(delete("/v2/portfolio/credits/{id}", credit), bearer).getStatus()).isEqualTo(204);
        var again = perform(delete("/v2/portfolio/credits/{id}", credit), bearer);
        assertThat(again.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(again.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"portfolio_credit_not_found\"}"));

        assertThat(perform(delete("/v2/portfolio/photos/{id}", photo), bearer).getStatus()).isEqualTo(204);
        assertThat(storage.objects).as("행과 사진 객체를 함께 지운다").isEmpty();
        var photoAgain = perform(delete("/v2/portfolio/photos/{id}", photo), bearer);
        assertThat(photoAgain.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(photoAgain.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"portfolio_photo_not_found\"}"));
        assertThat(json(patch("/v2/portfolio/credits/{id}", credit).content("{\"role\":\"x\"}"), 404).path("detail").textValue())
                .isEqualTo("portfolio_credit_not_found");
    }

    @Test
    @DisplayName("account.portfolio: 쉰한 번째 경력은 422 다")
    void accountPortfolio_theFiftyFirstCreditIsRejected() throws Exception {
        jdbc.update("INSERT INTO portfolios(user_id) VALUES (?)", member);
        for (int credit = 0; credit < 50; credit++) {
            jdbc.update("INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order) VALUES (?,?,?,?,2020,'other',?)",
                    UUID.randomUUID(), member, "작품 " + credit, "역", credit);
        }

        JsonNode rejected = json(post("/v2/portfolio/credits").content(
                "{\"title\":\"쉰한 번째\",\"role\":\"역\",\"year\":2020,\"kind\":\"other\"}"), 422);

        assertThat(rejected).isEqualTo(mapper.readTree("{\"detail\":\"portfolio_credit_limit_exceeded\"}"));
        assertThat(count("portfolio_credits")).isEqualTo(50);
    }

    @Test
    @DisplayName("account.portfolio: 값의 형태가 틀리면 422 배열 — 소개글 2,001자, 작품명 101자·빈 값, 연도 1899·내후년, 종류가 값 목록 밖")
    void accountPortfolio_malformedValuesAreValidationErrors() throws Exception {
        int nextYear = today().getYear() + 1;
        List<MockHttpServletRequestBuilder> malformed = List.of(
                put("/v2/portfolio/intro").content("{\"intro\":\"" + "가".repeat(2001) + "\"}"),
                post("/v2/portfolio/credits").content(credit("가".repeat(101), "역", 2020, "film")),
                post("/v2/portfolio/credits").content(credit("   ", "역", 2020, "film")),
                post("/v2/portfolio/credits").content(credit("작품", "역", 1899, "film")),
                post("/v2/portfolio/credits").content(credit("작품", "역", nextYear + 1, "film")),
                post("/v2/portfolio/credits").content(credit("작품", "역", 2020, "webtoon")),
                post("/v2/portfolio/credits").content("{\"title\":\"작품\"}"),
                put("/v2/portfolio/share").content("{}"));
        for (MockHttpServletRequestBuilder request : malformed) {
            assertThat(json(request, 422).path("detail").isArray()).isTrue();
        }
        assertThat(json(put("/v2/portfolio/intro").content("{\"intro\":\"" + "가".repeat(2000) + "\"}"), 200)
                .path("intro").textValue()).hasSize(2000);
        assertThat(json(post("/v2/portfolio/credits").content(credit("가".repeat(100), "역", nextYear, "ad")), 201)
                .path("year").intValue()).as("내년까지는 된다").isEqualTo(nextYear);
        assertThat(json(post("/v2/portfolio/credits").content(credit("작품", "역", 1900, "musical")), 201)
                .path("kind").textValue()).isEqualTo("musical");
    }

    @Test
    @DisplayName("account.portfolio: 한 IP 에서 1분에 61번째 공개 조회 — 429")
    void accountPortfolio_publicViewsAreLimitedPerIp() throws Exception {
        String address = "10.10.0." + ADDRESSES.incrementAndGet();
        for (int view = 0; view < 60; view++) {
            assertThat(visitFrom(address, "no-such-slug").getStatus()).isEqualTo(404);
        }

        var limited = visitFrom(address, "no-such-slug");

        assertThat(limited.getStatus()).isEqualTo(429);
        assertThat(mapper.readTree(limited.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
    }

    @Test
    @DisplayName("account.portfolio: 성별이 \"선택 안 함\"인 회원의 공개 페이지에는 성별이 null 로 온다(칸을 뺀다)")
    void accountPortfolio_unspecifiedGenderIsLeftOut() throws Exception {
        jdbc.update("UPDATE user_profiles SET gender='unspecified' WHERE user_id=?", member);
        String slug = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200).path("slug").textValue();

        JsonNode page = mapper.readTree(visit(slug).getContentAsString());

        assertThat(page.has("gender")).isTrue();
        assertThat(page.path("gender").isNull()).isTrue();
    }

    @Test
    @DisplayName("account.portfolio: 공개 조회는 로그인이 없다 — 만료된 토큰이 붙어 와도 열리고, 게이트에 걸리지 않는다")
    void accountPortfolio_publicViewIgnoresTokens() throws Exception {
        String slug = json(put("/v2/portfolio/share").content("{\"enabled\":true}"), 200).path("slug").textValue();

        var response = mvc.perform(get("/v2/public/portfolios/{slug}", slug)
                        .with(request -> {
                            request.setRemoteAddr("10.11.0." + ADDRESSES.incrementAndGet());
                            return request;
                        })
                        .header("Authorization", "Bearer expired.token.value"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.portfolio: 게스트 토큰으로 포트폴리오 API — 403 member_only. 동의·프로필이 끝나지 않은 회원도 막힌다")
    void accountPortfolio_isForGatedMembersOnly() throws Exception {
        UUID guest = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", guest);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'guest',?)",
                UUID.randomUUID(), guest, UUID.randomUUID().toString());
        AccountFixtures.grantAllConsents(jdbc, guest);
        String guestBearer = "Bearer " + jwt.issueAccessToken(guest).value();

        for (MockHttpServletRequestBuilder request : List.of(
                get("/v2/portfolio"),
                put("/v2/portfolio/intro").contentType(MediaType.APPLICATION_JSON).content("{\"intro\":\"x\"}"),
                put("/v2/portfolio/share").contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}"))) {
            var response = perform(request, guestBearer);
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"member_only\"}"));
        }

        UUID unfinished = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", unfinished);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), unfinished, "g-" + unfinished);
        AccountFixtures.grantAllConsents(jdbc, unfinished);
        var gated = perform(get("/v2/portfolio"), "Bearer " + jwt.issueAccessToken(unfinished).value());
        assertThat(gated.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(gated.getContentAsString()).path("detail").textValue()).isEqualTo("profile_required");

        UUID undecided = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", undecided);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), undecided, "g-" + undecided);
        var pending = perform(get("/v2/portfolio"), "Bearer " + jwt.issueAccessToken(undecided).value());
        assertThat(pending.getStatus()).isEqualTo(403);
        JsonNode pendingBody = mapper.readTree(pending.getContentAsString());
        assertThat(pendingBody.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(pendingBody.path("pending_consents").isArray()).isTrue();
        assertThat(pendingBody.path("pending_consents")).isNotEmpty();
    }

    // ---- helpers ----

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private JsonNode addCredit(String title, String role, int year, String kind) throws Exception {
        return json(post("/v2/portfolio/credits").content(credit(title, role, year, kind)), 201);
    }

    private String credit(String title, String role, int year, String kind) throws Exception {
        return mapper.writeValueAsString(Map.of("title", title, "role", role, "year", year, "kind", kind));
    }

    private JsonNode beginPhoto(String contentType, long sizeBytes, int status) throws Exception {
        return json(post("/v2/portfolio/photos").content(
                mapper.writeValueAsString(Map.of("content_type", contentType, "size_bytes", sizeBytes))), status);
    }

    /** 주소를 받고, 가짜 저장소에 그 크기로 올리고, 끝을 알린다. */
    private String uploadPhoto() throws Exception {
        JsonNode intent = beginPhoto("image/jpeg", 1000, 201);
        String photoId = intent.path("photo_id").textValue();
        String objectKey = jdbc.queryForObject(
                "SELECT object_key FROM portfolio_photos WHERE id=?", String.class, UUID.fromString(photoId));
        storage.objects.put(objectKey, 1000L);
        json(post("/v2/portfolio/photos/{id}/complete", photoId), 200);
        return photoId;
    }

    private MockHttpServletResponse visit(String slug) throws Exception {
        return visitFrom("10.12.0." + ADDRESSES.incrementAndGet(), slug);
    }

    private MockHttpServletResponse visitFrom(String address, String slug) throws Exception {
        return mvc.perform(get("/v2/public/portfolios/{slug}", slug).with(request -> {
            request.setRemoteAddr(address);
            return request;
        })).andReturn().getResponse();
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization)
            throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), bearer);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private static List<String> ids(JsonNode rows) {
        List<String> ids = new ArrayList<>();
        rows.forEach(row -> ids.add(row.path("id").textValue()));
        return ids;
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul")));
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. */
    static final class FakeStorage implements ObjectStorage {
        @Override
        public void upload(String objectKey, String mimeType, java.nio.file.Path source) {
            try {
                objects.put(objectKey, java.nio.file.Files.size(source));
            } catch (java.io.IOException failure) {
                throw new java.io.UncheckedIOException(failure);
            }
        }

        final Map<String, Long> objects = new ConcurrentHashMap<>();

        @Override
        public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://storage.test/put/" + objectKey;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://storage.test/get/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            Long size = objects.get(objectKey);
            return size == null ? null : new StoredObjectMetadata(size, "image/jpeg", "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }
}
