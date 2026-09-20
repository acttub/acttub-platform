package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
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
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.profile 의 "검증 방법"을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>시계는 돌릴 수 있는 것으로 갈아 끼운다 — 만 나이는 서버가 한국 시간의 날짜로 세고, 생일
 * 전날과 당일, 자정 앞뒤를 실제로 기다릴 수는 없다. 사진 객체는 메모리에 둔다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, AccountProfileIT.StorageFixture.class})
class AccountProfileIT {
    /**
     * 테스트마다 새 회원이다. 회원별 분당 60회 한도의 카운터는 지울 수단이 없어, 같은 회원을 돌려
     * 쓰면 뒤의 테스트가 앞의 것이 깎아 놓은 창에 걸린다.
     */
    private UUID userId;

    /** 한국 시간 2026-10-02 12:00. */
    private static final Instant NOON_IN_SEOUL = Instant.parse("2026-10-02T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_profile");
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

    @Autowired
    ObjectMapper mapper;

    @Autowired
    MutableClock clock;

    @Autowired
    FakeStorage storage;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,'actor@example.test','active')", userId);
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid)
                VALUES (?,?,'google','google-actor')
                """, UUID.randomUUID(), userId);
        clock.set(NOON_IN_SEOUL);
        storage.clear();
    }

    @Test
    void accountProfile_protectedApisAnswerProfileRequiredUntilTheSixItemsAreSavedWithTheSameToken()
            throws Exception {
        JsonNode before = me();
        assertThat(before).isEqualTo(mapper.readTree("""
                {"id":"%s","email":"actor@example.test",
                 "status":"active","account_type":"member","profile_complete":false,"profile":null}
                """.formatted(userId)));
        var blocked = protectedApi();
        assertThat(blocked.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(blocked.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"profile_required\"}"));

        var saved = save(profile());

        assertThat(saved.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(saved.getContentAsString())).isEqualTo(mapper.readTree("""
                {"id":"%s","email":"actor@example.test",
                 "status":"active","account_type":"member","profile_complete":true,
                 "profile":{"name":"김배우","gender":"female","birth_date":"2001-03-14","age":25,
                            "directions":["media"],"experience":"exam_prep","goal":"professional",
                            "photo_url":null,"bio":null}}
                """.formatted(userId)));
        // 사진과 소개 없이도 게이트를 지난다.
        assertThat(protectedApi().getStatus()).as("같은 토큰으로 허용된다").isEqualTo(200);
    }

    @Test
    void accountProfile_profileInputWaitsForTheConsents() throws Exception {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required)
                VALUES (?,'privacy','v5','개인정보 수집·이용 동의','본문',true)
                """, UUID.randomUUID());

        var blocked = save(profile());

        assertThat(blocked.getStatus()).as("개인정보를 받기 전에 수집 동의가 끝나 있어야 한다").isEqualTo(403);
        assertThat(mapper.readTree(blocked.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_required");
        assertThat(count("user_profiles")).isZero();

        AccountFixtures.grantAllConsents(jdbc, userId);
        assertThat(save(profile()).getStatus()).isEqualTo(200);
    }

    @Test
    void accountProfile_memberFromBefore1_0_0SeesTheOldNicknameInTheNameField() throws Exception {
        // V9 가 옛 닉네임을 이름으로 복사해 둔 모양이다. 옛 컬럼은 남아 있지만 새 서버는 읽지 않는다.
        jdbc.update("UPDATE users SET nickname='옛 컬럼에만 남은 값' WHERE id=?", userId);
        assertThat(me().path("profile").isNull()).as("프로필 행이 없으면 옛 컬럼에 값이 있어도 비어 있다").isTrue();
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'옛 닉네임')", userId);

        JsonNode me = me();

        assertThat(me.path("profile_complete").booleanValue()).isFalse();
        assertThat(me.path("profile")).isEqualTo(mapper.readTree("""
                {"name":"옛 닉네임","gender":null,"birth_date":null,"age":null,"directions":[],
                 "experience":null,"goal":null,"photo_url":null,"bio":null}
                """));
        assertThat(protectedApi().getStatus()).isEqualTo(403);
    }

    @Test
    void accountProfile_bothDirectionsAreSavedAndComeBack() throws Exception {
        Map<String, Object> body = profile();
        body.put("directions", List.of("stage", "media", "stage"));

        assertThat(save(body).getStatus()).isEqualTo(200);

        assertThat(me().path("profile").path("directions"))
                .isEqualTo(mapper.readTree("[\"media\",\"stage\"]"));
        assertThat(jdbc.queryForList(
                "SELECT direction FROM user_profile_directions ORDER BY direction", String.class))
                .containsExactly("media", "stage");
    }

    @Test
    void accountProfile_ageIsCountedOnTheKoreanDateAndTurnsOnTheBirthday() throws Exception {
        Map<String, Object> body = profile();
        body.put("birth_date", "2000-10-03");
        assertThat(save(body).getStatus()).isEqualTo(200);

        // 생일 전날(한국 시간 10월 2일).
        assertThat(me().path("profile").path("age").intValue()).isEqualTo(25);

        // 한국 시간 10월 3일 0시 30분 — UTC 로는 아직 10월 2일이다.
        clock.set(Instant.parse("2026-10-02T15:30:00Z"));
        assertThat(me().path("profile").path("age").intValue()).isEqualTo(26);
    }

    @Test
    void accountProfile_someoneTurningFourteenTodayIsAcceptedEvenJustAfterMidnightInKorea()
            throws Exception {
        clock.set(Instant.parse("2026-10-01T15:30:00Z"));
        Map<String, Object> body = profile();
        body.put("birth_date", "2012-10-02");

        var saved = save(body);

        assertThat(saved.getStatus()).as(saved.getContentAsString()).isEqualTo(200);
        assertThat(mapper.readTree(saved.getContentAsString()).path("profile").path("age").intValue())
                .isEqualTo(14);
    }

    @Test
    void accountProfile_underFourteenAtTheSignupGateErasesTheAccountAndTheNextLoginStartsOver()
            throws Exception {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required)
                VALUES (?,'terms','v1','약관','본문',true)
                """, UUID.randomUUID());
        AccountFixtures.grantAllConsents(jdbc, userId);
        jdbc.update("""
                INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
                VALUES (?,?,?,now() + interval '1 day')
                """, UUID.randomUUID(), userId, "a".repeat(64));
        jdbc.update("INSERT INTO push_tokens(user_id,token,platform) VALUES (?,'ExponentPushToken[x]','ios')",
                userId);
        Map<String, Object> body = profile();
        body.put("birth_date", "2012-10-03");

        var closed = save(body);

        assertThat(closed.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(closed.getContentAsString()))
                .as("규칙에 걸린 422 의 본문은 사유 코드 하나다")
                .isEqualTo(mapper.readTree("{\"detail\":\"under_14_account_closed\"}"));
        for (String table : List.of("users", "user_identities", "user_consents", "refresh_tokens",
                "push_tokens", "user_profiles")) {
            assertThat(count(table)).as("%s 에 그 계정의 행이 없다", table).isZero();
        }
        // 토큰은 죽었다. 다시 로그인하면 처음 온 신원이라 동의 화면부터 시작한다.
        assertThat(mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void accountProfile_underFourteenInSettingsIsOnlyRejectedAndNothingChanges() throws Exception {
        assertThat(save(profile()).getStatus()).isEqualTo(200);
        Map<String, Object> younger = profile();
        younger.put("birth_date", "2013-01-01");
        younger.put("name", "바뀐 이름");

        var rejected = save(younger);

        assertThat(rejected.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(rejected.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"under_14\"}"));
        assertThat(me().path("profile").path("birth_date").textValue()).isEqualTo("2001-03-14");
        assertThat(me().path("profile").path("name").textValue()).isEqualTo("김배우");
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, userId))
                .isEqualTo("active");
    }

    @Test
    void accountProfile_memberFromBefore1_0_0WithPracticesWhoIsUnderFourteenIsClosedLikeAWithdrawal()
            throws Exception {
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'옛 닉네임')", userId);
        jdbc.update("UPDATE users SET nickname='옛 닉네임' WHERE id=?", userId);
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'finalized','s3','users/old/practice.mp4','video/mp4',12,now())
                """, UUID.randomUUID(), userId);
        Map<String, Object> body = profile();
        body.put("birth_date", "2013-01-01");

        var closed = save(body);

        assertThat(closed.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(closed.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"under_14_account_closed\"}"));
        assertThat(jdbc.queryForMap("SELECT status,email,nickname FROM users WHERE id=?", userId))
                .as("자료가 있는 계정은 행을 지우지 않고 탈퇴와 같은 절차로 닫는다")
                .containsEntry("status", "deactivated")
                .containsEntry("email", null)
                .containsEntry("nickname", null);
        // 탈퇴와 같은 절차다 — 신원 행은 제공자 ID 를 비우고 해시만 남긴다 (ADR-029).
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM user_identities WHERE provider_uid IS NOT NULL", Integer.class)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM user_identities WHERE uid_hash IS NULL", Integer.class)).isZero();
        assertThat(count("upload_intents")).isEqualTo(1);
        assertThat(mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    @Test
    void accountProfile_everyItemCanBeChangedInSettingsAndNoneCanBeEmptied() throws Exception {
        assertThat(save(profile()).getStatus()).isEqualTo(200);
        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("name", "  새   활동명 ");
        changed.put("gender", "unspecified");
        changed.put("birth_date", "1999-12-31");
        changed.put("directions", List.of("stage"));
        changed.put("experience", "over_5y");
        changed.put("goal", "hobby");
        changed.put("bio", " 무대에서 오래 버티는 배우 ");

        assertThat(save(changed).getStatus()).isEqualTo(200);

        assertThat(me().path("profile")).isEqualTo(mapper.readTree("""
                {"name":"새 활동명","gender":"unspecified","birth_date":"1999-12-31","age":26,
                 "directions":["stage"],"experience":"over_5y","goal":"hobby",
                 "photo_url":null,"bio":"무대에서 오래 버티는 배우"}
                """));

        for (String item : List.of("name", "gender", "birth_date", "directions", "experience", "goal")) {
            Map<String, Object> missing = new LinkedHashMap<>(changed);
            missing.remove(item);
            assertValidationArray(save(missing), item);
            Map<String, Object> emptied = new LinkedHashMap<>(changed);
            emptied.put(item, "directions".equals(item) ? List.of() : "");
            assertValidationArray(save(emptied), item);
        }
        assertThat(me().path("profile").path("name").textValue()).isEqualTo("새 활동명");
    }

    @Test
    void accountProfile_valuesOutsideTheListsAndOverTheLimitsAreShapeErrors() throws Exception {
        for (Map.Entry<String, Object> invalid : Map.<String, Object>of(
                "gender", "other",
                "experience", "y10",
                "goal", "fame",
                "directions", List.of("voice"),
                "birth_date", "2027-01-01",
                "name", "가".repeat(21),
                "bio", "가".repeat(81)).entrySet()) {
            Map<String, Object> body = profile();
            body.put(invalid.getKey(), invalid.getValue());
            assertValidationArray(save(body), invalid.getKey());
        }
        // 이름 스무 자와 소개 여든 자는 받는다(코드포인트로 센다).
        Map<String, Object> atTheLimit = profile();
        atTheLimit.put("name", "😀".repeat(20));
        atTheLimit.put("bio", "가".repeat(80));
        assertThat(save(atTheLimit).getStatus()).isEqualTo(200);
        assertThat(count("user_profiles")).isEqualTo(1);
    }

    @Test
    void accountProfile_nicknameEditingIsGone() throws Exception {
        var response = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"이름\"}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(405);
    }

    @Test
    void accountProfile_photoIsUploadedThroughAPresignedAddressAndTheOldObjectIsRemoved()
            throws Exception {
        assertThat(save(profile()).getStatus()).isEqualTo(200);

        var intent = photoUpload("image/jpeg", 482_113);
        assertThat(intent.getStatus()).isEqualTo(201);
        JsonNode created = mapper.readTree(intent.getContentAsString());
        assertThat(created.fieldNames()).toIterable().containsExactlyInAnyOrder("upload_url", "expires_at");
        String firstKey = storage.presigned.getLast();
        assertThat(firstKey).startsWith("users/" + userId + "/profile/").endsWith(".jpg");
        assertThat(created.path("upload_url").textValue()).isEqualTo("https://storage.test/put/" + firstKey);

        // 아직 올리지 않았다.
        assertError(completePhoto(), 409, "upload_not_found");
        storage.put(firstKey, 482_113);
        var completed = completePhoto();
        assertThat(completed.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(completed.getContentAsString()).path("profile").path("photo_url").textValue())
                .isEqualTo("https://storage.test/get/" + firstKey);

        // 새 사진으로 바꾸면 옛 객체를 지운다.
        assertThat(photoUpload("image/png", 1_000).getStatus()).isEqualTo(201);
        String secondKey = storage.presigned.getLast();
        storage.put(secondKey, 1_000);
        assertThat(completePhoto().getStatus()).isEqualTo(200);
        assertThat(storage.objects).containsOnlyKeys(secondKey);

        assertThat(mvc.perform(delete("/v2/me/photo").header("Authorization", bearer()))
                .andReturn().getResponse().getStatus()).isEqualTo(204);
        assertThat(storage.objects).isEmpty();
        assertThat(me().path("profile").path("photo_url").isNull()).isTrue();
        assertThat(mvc.perform(delete("/v2/me/photo").header("Authorization", bearer()))
                .andReturn().getResponse().getStatus()).as("사진이 없어도 204 다").isEqualTo(204);
    }

    @Test
    void accountProfile_photoSafetyNetAnswersLikeTheVideoUpload() throws Exception {
        assertThat(save(profile()).getStatus()).isEqualTo(200);

        assertError(photoUpload("image/jpeg", 11L * 1024 * 1024), 413, "upload_too_large");
        assertError(photoUpload("application/pdf", 1_000), 415, "unsupported_media_type");
        assertError(photoUpload("video/mp4", 1_000), 415, "unsupported_media_type");
        for (String accepted : List.of("image/jpeg", "image/png", "image/webp", "image/heic")) {
            assertThat(photoUpload(accepted, 10L * 1024 * 1024).getStatus()).as(accepted).isEqualTo(201);
        }

        // 알린 크기와 다르게 올렸다(10MB 우회 방지). 주소의 유효 시간이 지나도 끝낼 수 없다.
        storage.put(storage.presigned.getLast(), 999);
        assertError(completePhoto(), 409, "upload_size_mismatch");
        clock.advance(java.time.Duration.ofMinutes(31));
        assertError(completePhoto(), 409, "upload_intent_expired");
    }

    @Test
    void accountProfile_photoIsAProtectedFeature() throws Exception {
        assertError(photoUpload("image/jpeg", 1_000), 403, "profile_required");
    }

    // ---- helpers ----

    private static Map<String, Object> profile() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "김배우");
        body.put("gender", "female");
        body.put("birth_date", "2001-03-14");
        body.put("directions", List.of("media"));
        body.put("experience", "exam_prep");
        body.put("goal", "professional");
        return body;
    }

    private MockHttpServletResponse save(Map<String, Object> body) throws Exception {
        return mvc.perform(put("/v2/me/profile")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse photoUpload(String contentType, long sizeBytes) throws Exception {
        return mvc.perform(post("/v2/me/photo")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(
                                Map.of("content_type", contentType, "size_bytes", sizeBytes))))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse completePhoto() throws Exception {
        return mvc.perform(post("/v2/me/photo/complete").header("Authorization", bearer()))
                .andReturn().getResponse();
    }

    private JsonNode me() throws Exception {
        var response = mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse protectedApi() throws Exception {
        return mvc.perform(get("/v2/practice-sessions").header("Authorization", bearer()))
                .andReturn().getResponse();
    }

    private void assertError(MockHttpServletResponse response, int status, String detail) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"" + detail + "\"}"));
    }

    /** 본문 모양이 틀린 422 — detail 이 배열이고 그 항목을 가리킨다. */
    private void assertValidationArray(MockHttpServletResponse response, String item) throws Exception {
        assertThat(response.getStatus()).as("%s: %s", item, response.getContentAsString()).isEqualTo(422);
        JsonNode detail = mapper.readTree(response.getContentAsString()).path("detail");
        assertThat(detail.isArray()).as(item).isTrue();
        assertThat(detail.get(0).path("loc").get(1).textValue()).isEqualTo(item);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇에 서명해 줬고 무엇이 남아 있는지만 안다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();
        final List<String> presigned = new ArrayList<>();

        void clear() {
            objects.clear();
            presigned.clear();
        }

        void put(String objectKey, long sizeBytes) {
            objects.put(objectKey, sizeBytes);
        }

        @Override
        public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            presigned.add(objectKey);
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
