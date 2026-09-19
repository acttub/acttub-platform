package com.acttub.actingapi.feature.transfer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.memory.app.MemoryExtractor;
import com.acttub.actingapi.feature.memory.app.MemoryRepository;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateQueue;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateWorker;
import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.guest 의 "검증 방법" 가운데 옮기기를 HTTP 와 실제 Postgres 로 본다. 동시성과 도중 실패는 같은
 * 이음매에서 요청을 겹쳐 보내거나 DB 가 거절하게 만들어 본다.
 *
 * <p>대본·리딩 회차·녹음은 아직 서버에 없어(웹 리딩은 기기 안에서 돈다) 옮길 행이 없다. 지금 옮기는 것은
 * {@code user_id} 가 있는 자료 행 전부다 — 올린 영상, 연습, 작업 장부, 배우 기억.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    // 기억 갱신 워커는 테스트가 직접 구동한다. 자동 poll 이 작업을 먼저 집으면 안 된다.
    "ANALYSIS_WORKER_ENABLED=false",
    // 겹쳐 보낸 요청 여섯이 저마다 커넥션을 쥔 채 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class GuestTransferIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final long ISSUE_GATE = 528_008L;
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("guest_transfer");
        database = name;
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
    PushTokenRepository pushTokens;

    @Autowired
    TransferCodeRepository codes;

    @Autowired
    MemoryRepository memories;

    @Autowired
    MemoryUpdateQueue memoryQueue;

    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_operation_transfer ON external_operations");
        jdbc.execute("DROP TRIGGER IF EXISTS hold_code_insert ON guest_transfer_codes");
        jdbc.execute("DROP TRIGGER IF EXISTS hold_memory_insert ON actor_memory_entries");
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        address = "10.6.0." + ADDRESSES.incrementAndGet();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    }

    @Test
    @DisplayName("account.guest: 게스트로 연습 하나를 끝내고 코드를 받아 앱에서 입력 — 회원의 연습 목록에 그 연습이 보이고, 자료 행의 user_id 가 회원이며 게스트 users 행은 deactivated 다")
    void accountGuest_transferMovesEveryRowToTheMemberAndClosesTheGuest() throws Exception {
        Guest guest = guest();
        UUID session = practice(guest.id());
        UUID operation = operation(guest.id(), session, "report", "succeeded");
        UUID member = member();
        UUID own = practice(member);

        JsonNode issued = issueCode(guest);
        assertThat(issued.fieldNames()).toIterable().containsExactlyInAnyOrder("code", "expires_in", "expires_at");
        assertThat(issued.path("code").textValue()).matches("[0-9]{6}");
        assertThat(issued.path("expires_in").longValue()).isEqualTo(600);
        assertThat(jdbc.queryForObject("SELECT code_hash FROM guest_transfer_codes", String.class))
                .as("해시로만 저장한다").doesNotContain(issued.path("code").textValue());

        var response = transfer(member, issued.path("code").textValue(), null);

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("{\"transferred\":true}"));
        assertThat(owner("practice_sessions", session)).isEqualTo(member);
        assertThat(owner("external_operations", operation)).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM upload_intents WHERE user_id=?", Integer.class, guest.id()))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM upload_intents WHERE user_id=?", Integer.class, member))
                .isEqualTo(2);

        JsonNode list = mapper.readTree(mvc.perform(get("/v2/practice-sessions")
                .header("Authorization", "Bearer " + jwt.issueAccessToken(member).value()))
                .andReturn().getResponse().getContentAsString());
        assertThat(list.path("sessions")).extracting(row -> row.path("session_id").textValue())
                .as("옮긴 연습은 회원의 목록에 섞여 보인다")
                .containsExactlyInAnyOrder(session.toString(), own.toString());

        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest.id()))
                .isEqualTo("deactivated");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, guest.id()))
                .as("신원 행은 지운다").isZero();
        assertThat(jdbc.queryForMap("""
                SELECT count(*) AS total,count(revoked_at) AS revoked FROM refresh_tokens WHERE user_id=?
                """, guest.id()))
                .as("리프레시 토큰은 폐기하되 행은 남긴다")
                .containsEntry("total", 1L).containsEntry("revoked", 1L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_consents WHERE user_id=?", Integer.class, guest.id()))
                .as("동의 기록은 게스트 행에 남긴다").isEqualTo(1);
    }

    @Test
    @DisplayName("account.guest: 같은 코드를 다시 입력 — 404. 발급 11분 뒤 입력 — 404. 새 코드를 받은 뒤 옛 코드 — 404")
    void accountGuest_aCodeWorksOnceForTenMinutesAndIsReplacedByANewOne() throws Exception {
        UUID member = member();

        Guest used = guest();
        String usedCode = issueCode(used).path("code").textValue();
        assertThat(transfer(member, usedCode, null).getStatus()).isEqualTo(200);
        assertNotFound(transfer(member, usedCode, null));

        Guest late = guest();
        String lateCode = issueCode(late).path("code").textValue();
        clock.advance(Duration.ofMinutes(11));
        assertNotFound(transfer(member, lateCode, null));
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, late.id()))
                .isEqualTo("active");

        Guest replaced = guest();
        String oldCode = issueCode(replaced).path("code").textValue();
        String newCode = issueCode(replaced).path("code").textValue();
        if (!oldCode.equals(newCode)) {
            assertNotFound(transfer(member, oldCode, null));
        }
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM guest_transfer_codes WHERE user_id=?", Integer.class, replaced.id()))
                .as("게스트마다 살아 있는 코드는 하나다").isEqualTo(1);
        assertThat(transfer(member, newCode, null).getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.guest: 틀린 코드를 1분 안에 6번 — 여섯 번째는 429. 한도를 채운 뒤에는 맞는 코드도 평가하지 않는다")
    void accountGuest_wrongAttemptsAreLimitedPerMember() throws Exception {
        UUID member = member();
        Guest guest = guest();
        String code = issueCode(guest).path("code").textValue();
        String wrong = code.equals("000000") ? "000001" : "000000";

        for (int attempt = 0; attempt < 5; attempt++) {
            assertNotFound(transfer(member, wrong, null));
        }
        var sixth = transfer(member, wrong, null);
        var correctButLimited = transfer(member, code, null);

        assertThat(sixth.getStatus()).isEqualTo(429);
        assertThat(mapper.readTree(sixth.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
        assertThat(correctButLimited.getStatus()).isEqualTo(429);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest.id()))
                .isEqualTo("active");
    }

    @Test
    @DisplayName("account.guest: 한 IP 에서 여러 회원으로 1분 안에 11번 — 열한 번째는 429. 모양이 틀린 코드(422)는 틀린 시도로 세지 않는다")
    void accountGuest_wrongAttemptsAreLimitedPerIp() throws Exception {
        List<UUID> members = List.of(member(), member(), member());
        var malformed = transfer(members.get(0), "12345", null);
        assertThat(malformed.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(malformed.getContentAsString()).path("detail").isArray()).isTrue();

        for (int attempt = 0; attempt < 10; attempt++) {
            assertNotFound(transfer(members.get(attempt % 3), "000000", null));
        }

        assertThat(transfer(members.get(1), "000000", null).getStatus()).isEqualTo(429);
    }

    @Test
    @DisplayName("account.guest: 틀린 코드 여섯 개를 겹쳐 보내도 평가되는 것은 다섯이다 — 자리를 먼저 잡고 평가한다(여섯 번째는 429)")
    void accountGuest_overlappingWrongAttemptsCannotSlipPastTheMemberLimit() throws Exception {
        UUID member = member();
        int attempts = 6;
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        try (Connection blocker = outsideConnection()) {
            // 코드 평가(lockLive)가 이 잠금에서 멈춘다 — 한도 확인과 세기 사이에 요청 여섯을 세워 둔다.
            blocker.setAutoCommit(false);
            try (Statement statement = blocker.createStatement()) {
                statement.execute("LOCK TABLE guest_transfer_codes IN ACCESS EXCLUSIVE MODE");
            }
            List<Future<Integer>> racing = new ArrayList<>();
            for (int attempt = 0; attempt < attempts; attempt++) {
                String wrong = "00000" + attempt;
                racing.add(pool.submit(() -> transfer(member, wrong, null).getStatus()));
            }
            awaitUntil("every request is either waiting on the code table or answered", attempts,
                    () -> waitingOnCodeTable() + (int) racing.stream().filter(Future::isDone).count());
            blocker.rollback();

            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : racing) {
                statuses.add(future.get());
            }

            assertThat(statuses).containsExactlyInAnyOrder(404, 404, 404, 404, 404, 429);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("account.guest: 기억 선택이 필요한 409 와 맞은 코드는 틀린 시도의 자리를 되돌려 준다 — 409 여섯 번 뒤에도 옮길 수 있다")
    void accountGuest_conflictsAndCorrectCodesGiveTheirSlotBack() throws Exception {
        UUID member = member();
        memory(member, "goal", "회원의 목표");
        Guest guest = guest();
        memory(guest.id(), "goal", "게스트의 목표");
        String code = issueCode(guest).path("code").textValue();

        for (int attempt = 0; attempt < 6; attempt++) {
            assertThat(transfer(member, code, null).getStatus()).isEqualTo(409);
        }

        assertThat(transfer(member, code, "member").getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.guest: 코드가 없는 게스트가 두 탭에서 동시에 코드를 받아도 살아 있는 코드는 하나다")
    void accountGuest_overlappingIssuanceLeavesOneLiveCode() throws Exception {
        Guest guest = guest();
        holdCodeInserts();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            closeIssueGate(gate);
            List<Future<JsonNode>> racing = new ArrayList<>();
            for (int tab = 0; tab < 2; tab++) {
                racing.add(pool.submit(() -> issueCode(guest)));
            }
            // 둘 다 "앞의 코드 지우기"(0행)를 지나 새 코드를 넣는 자리에서 멈춘다.
            awaitUntil("both issuances are waiting", 2, this::lockWaiters);
            openIssueGate(gate);

            List<String> issued = List.of(
                    racing.get(0).get().path("code").textValue(), racing.get(1).get().path("code").textValue());

            assertThat(issued).allMatch(code -> code.matches("[0-9]{6}"));
            assertThat(jdbc.queryForObject("""
                    SELECT count(*) FROM guest_transfer_codes WHERE user_id=? AND used_at IS NULL
                    """, Integer.class, guest.id()))
                    .as("게스트마다 살아 있는 코드는 하나다").isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("account.guest: 서로 다른 게스트가 같은 해시의 코드를 동시에 받으면 한쪽만 적힌다 — 진 쪽은 다시 뽑는다")
    void accountGuest_overlappingIssuanceOfTheSameCodeToTwoGuestsKeepsOne() throws Exception {
        List<Guest> guests = List.of(guest(), guest());
        Instant now = clock.instant();
        holdCodeInserts();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            closeIssueGate(gate);
            List<Future<Boolean>> racing = new ArrayList<>();
            for (Guest guest : guests) {
                racing.add(pool.submit(() -> codes.issue(guest.id(), "same-hash", now, now.plusSeconds(600))));
            }
            awaitUntil("both issuances are waiting", 2, this::lockWaiters);
            openIssueGate(gate);

            assertThat(List.of(racing.get(0).get(), racing.get(1).get())).containsExactlyInAnyOrder(true, false);
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM guest_transfer_codes WHERE code_hash='same-hash'", Integer.class))
                    .isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("account.guest: 다른 게스트의 시한이 지난 코드는 같은 숫자의 새 발급을 막지 않는다")
    void accountGuest_anExpiredCodeOfAnotherGuestDoesNotBlockTheSameCode() throws Exception {
        List<Guest> guests = List.of(guest(), guest());
        Instant now = clock.instant();
        assertThat(codes.issue(guests.get(0).id(), "reused-hash", now, now.plusSeconds(600))).isTrue();

        Instant later = now.plus(Duration.ofMinutes(11));

        assertThat(codes.issue(guests.get(1).id(), "reused-hash", later, later.plusSeconds(600))).isTrue();
        assertThat(codes.inTransaction(() -> codes.lockLive("reused-hash", later)).guestId())
                .isEqualTo(guests.get(1).id());
    }

    @Test
    @DisplayName("account.guest: 기억이 있는 회원에 기억이 있는 게스트를 옮기면 409 — 아무것도 옮겨지지 않고 같은 코드를 다시 쓸 수 있다. 웹 것을 고르면 회원의 옛 기억이 지워지고 게스트 기억이 회원 것이 된다")
    void accountGuest_memoryChoiceGuestReplacesTheMembersMemory() throws Exception {
        UUID member = member();
        memory(member, "goal", "회원의 목표");
        Guest guest = guest();
        UUID session = practice(guest.id());
        memory(guest.id(), "goal", "게스트의 목표");
        memory(guest.id(), "gender", "여");
        String code = issueCode(guest).path("code").textValue();

        var undecided = transfer(member, code, null);

        assertThat(undecided.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(undecided.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"memory_choice_required\"}"));
        assertThat(owner("practice_sessions", session)).as("아무것도 옮기지 않았다").isEqualTo(guest.id());
        assertThat(jdbc.queryForObject("SELECT used_at FROM guest_transfer_codes", java.sql.Timestamp.class))
                .as("409 는 코드를 소진하지 않는다").isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest.id()))
                .isEqualTo("active");

        assertThat(transfer(member, code, "guest").getStatus()).isEqualTo(200);

        assertThat(jdbc.queryForList(
                "SELECT field || '=' || value FROM actor_memory_entries WHERE user_id=? ORDER BY field",
                String.class, member)).containsExactly("gender=여", "goal=게스트의 목표");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM actor_memory_entries WHERE user_id=?", Integer.class, guest.id())).isZero();
        assertThat(owner("practice_sessions", session)).isEqualTo(member);
    }

    @Test
    @DisplayName("account.guest: 회원 것을 고르면 게스트 기억은 버려진다. 회원에게 기억이 없으면 묻지 않고 게스트의 기억을 옮긴다")
    void accountGuest_memoryChoiceMemberDiscardsTheGuestsMemory() throws Exception {
        UUID member = member();
        memory(member, "goal", "회원의 목표");
        Guest guest = guest();
        memory(guest.id(), "goal", "게스트의 목표");

        assertThat(transfer(member, issueCode(guest).path("code").textValue(), "member").getStatus()).isEqualTo(200);

        assertThat(jdbc.queryForList("SELECT value FROM actor_memory_entries", String.class))
                .containsExactly("회원의 목표");

        UUID blank = member();
        Guest second = guest();
        memory(second.id(), "goal", "두 번째 게스트의 목표");

        assertThat(transfer(blank, issueCode(second).path("code").textValue(), null).getStatus()).isEqualTo(200);

        assertThat(jdbc.queryForList(
                "SELECT value FROM actor_memory_entries WHERE user_id=?", String.class, blank))
                .containsExactly("두 번째 게스트의 목표");
    }

    @Test
    @DisplayName("account.guest: 옮긴 뒤 옛 게스트 토큰의 요청에는 사유 guest_transferred 가 온다 — 액세스 403, 갱신 401. account_deactivated 보다 먼저다")
    void accountGuest_aTransferredGuestsTokensSayWhy() throws Exception {
        Guest guest = guest();
        assertThat(transfer(member(), issueCode(guest).path("code").textValue(), null).getStatus()).isEqualTo(200);

        List<MockHttpServletResponse> access = List.of(
                mvc.perform(get("/v2/me").header("Authorization", "Bearer " + guest.accessToken()))
                        .andReturn().getResponse(),
                mvc.perform(get("/v2/practice-sessions").header("Authorization", "Bearer " + guest.accessToken()))
                        .andReturn().getResponse(),
                mvc.perform(get("/v2/consents/entry").header("Authorization", "Bearer " + guest.accessToken()))
                        .andReturn().getResponse(),
                mvc.perform(delete("/v2/me").header("Authorization", "Bearer " + guest.accessToken()))
                        .andReturn().getResponse());
        var refresh = mvc.perform(post("/v2/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + guest.refreshToken() + "\"}"))
                .andReturn().getResponse();

        for (var response : access) {
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
        }
        assertThat(refresh.getStatus()).isEqualTo(401);
        assertThat(mapper.readTree(refresh.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
    }

    @Test
    @DisplayName("account.guest: 탈퇴로 닫힌 게스트의 토큰은 옮겨진 것이 아니다 — account_deactivated 다")
    void accountGuest_aWithdrawnGuestIsNotATransferredGuest() throws Exception {
        Guest guest = guest();
        issueCode(guest);
        assertThat(mvc.perform(delete("/v2/me").header("Authorization", "Bearer " + guest.accessToken()))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        var response = mvc.perform(get("/v2/me").header("Authorization", "Bearer " + guest.accessToken()))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"account_deactivated\"}"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, guest.id()))
                .as("게스트 신원은 해시 없이 행째 지운다").isZero();
    }

    @Test
    @DisplayName("account.guest: 옮기기를 중간에 실패시키면 어느 행의 user_id 도 바뀌지 않고 같은 코드로 다시 성공한다")
    void accountGuest_aFailureHalfwayMovesNothingAndKeepsTheCode() throws Exception {
        UUID member = member();
        Guest guest = guest();
        UUID session = practice(guest.id());
        UUID operation = operation(guest.id(), session, "report", "succeeded");
        memory(guest.id(), "goal", "게스트의 목표");
        String code = issueCode(guest).path("code").textValue();
        // 올린 영상·연습·기억의 주인을 바꾼 뒤, 작업 장부에서 DB 가 거절한다.
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION fail_operation_transfer() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'forced transfer failure';
                END
                $$ LANGUAGE plpgsql
                """);
        jdbc.execute("""
                CREATE TRIGGER fail_operation_transfer
                BEFORE UPDATE ON external_operations
                FOR EACH ROW EXECUTE FUNCTION fail_operation_transfer()
                """);

        var failed = transfer(member, code, null);

        assertThat(failed.getStatus()).isEqualTo(500);
        assertThat(mapper.readTree(failed.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"internal_server_error\"}"));
        assertThat(owner("practice_sessions", session)).isEqualTo(guest.id());
        assertThat(owner("external_operations", operation)).isEqualTo(guest.id());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM upload_intents WHERE user_id=?", Integer.class, guest.id()))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_memory_entries WHERE user_id=?", Integer.class, guest.id()))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest.id()))
                .isEqualTo("active");
        assertThat(jdbc.queryForObject("SELECT used_at FROM guest_transfer_codes", java.sql.Timestamp.class)).isNull();

        jdbc.execute("DROP TRIGGER fail_operation_transfer ON external_operations");

        assertThat(transfer(member, code, null).getStatus()).isEqualTo(200);
        assertThat(owner("practice_sessions", session)).isEqualTo(member);
        assertThat(owner("external_operations", operation)).isEqualTo(member);
    }

    @Test
    @DisplayName("account.guest: 같은 코드를 두 회원이 동시에 넣으면 한 사람만 받는다 — 게스트 하나는 한 번만 옮겨진다")
    void accountGuest_twoMembersRacingForOneCode() throws Exception {
        Guest guest = guest();
        UUID session = practice(guest.id());
        String code = issueCode(guest).path("code").textValue();
        List<UUID> members = List.of(member(), member());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Integer>> racing = new ArrayList<>();
            for (UUID member : members) {
                Callable<Integer> attempt = () -> {
                    start.await();
                    return transfer(member, code, null).getStatus();
                };
                racing.add(pool.submit(attempt));
            }
            start.countDown();

            List<Integer> statuses = List.of(racing.get(0).get(), racing.get(1).get());

            assertThat(statuses).containsExactlyInAnyOrder(200, 404);
            assertThat(members).contains(owner("practice_sessions", session));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM guest_transfer_codes WHERE used_at IS NOT NULL",
                    Integer.class)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("account.guest: 분석 중에 옮기면 진행 중 작업도 따라가고 완료 알림은 회원의 폰으로 간다. 한 회원이 게스트 둘을 차례로 옮기면 둘 다 목록에 보인다")
    void accountGuest_workInProgressFollowsAndTheMemberIsNotified() throws Exception {
        UUID member = member();
        pushTokens.register(member, "ExponentPushToken[member-phone]", "ios");
        Guest first = guest();
        UUID analyzing = practice(first.id());
        jdbc.update("UPDATE practice_sessions SET status='analyzing' WHERE id=?", analyzing);
        UUID running = operation(first.id(), analyzing, "analyze", "running");
        UUID lease = UUID.randomUUID();
        jdbc.update("UPDATE external_operations SET lease_token=?,lease_expires_at=now() + interval '5 minutes' WHERE id=?",
                lease, running);
        Guest second = guest();
        UUID finished = practice(second.id());

        assertThat(transfer(member, issueCode(first).path("code").textValue(), null).getStatus()).isEqualTo(200);
        assertThat(transfer(member, issueCode(second).path("code").textValue(), null).getStatus()).isEqualTo(200);

        assertThat(jdbc.queryForMap("SELECT user_id,status,lease_token FROM external_operations WHERE id=?", running))
                .as("상태와 lease 는 그대로라 돌고 있던 워커가 끝낸다")
                .containsEntry("user_id", member).containsEntry("status", "running").containsEntry("lease_token", lease);
        assertThat(pushTokens.analysisDoneTargets(analyzing)).containsExactly("ExponentPushToken[member-phone]");
        JsonNode list = mapper.readTree(mvc.perform(get("/v2/practice-sessions")
                .header("Authorization", "Bearer " + jwt.issueAccessToken(member).value()))
                .andReturn().getResponse().getContentAsString());
        assertThat(list.path("sessions")).extracting(row -> row.path("session_id").textValue())
                .containsExactlyInAnyOrder(analyzing.toString(), finished.toString());
    }

    @Test
    @DisplayName("account.guest: 기억 갱신이 모델 응답을 기다리는 사이에 옮기면 새 기억은 회원의 것이 된다 — 닫힌 게스트에게 기억이 다시 생기지 않는다")
    void accountGuest_aMemoryUpdateWaitingOnTheModelLandsOnTheMember() throws Exception {
        UUID member = member();
        Guest guest = guest();
        UUID session = practice(guest.id());
        UUID update = operation(guest.id(), session, "memory_update", "pending");
        String code = issueCode(guest).path("code").textValue();
        // 워커는 자료(주인=게스트)를 읽은 뒤 모델을 부른다. 그 응답을 기다리는 사이에 이관이 끝난다.
        MemoryUpdateWorker worker = memoryWorker((system, user) -> {
            try {
                assertThat(transfer(member, code, null).getStatus()).isEqualTo(200);
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
            return new GeneratedText("{\"goal\":\"새 목표\"}", new TokenUsage(0, 0, 0));
        });

        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(jdbc.queryForObject("SELECT status FROM external_operations WHERE id=?", String.class, update))
                .isEqualTo("succeeded");
        assertThat(jdbc.queryForList("SELECT value FROM actor_memory_entries WHERE user_id=?", String.class, member))
                .as("진행 중 작업도 따라간다 — 결과는 그때의 주인(회원)에게 간다").containsExactly("새 목표");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM actor_memory_entries WHERE user_id=?", Integer.class, guest.id()))
                .as("닫힌 게스트에게 기억이 생기지 않는다").isZero();
    }

    @Test
    @DisplayName("account.guest: 기억 갱신이 저장하는 도중에 옮기기가 시작돼도 그 기억은 회원에게 간다 — 옮기기는 작업 장부를 잡은 뒤에 기억을 본다")
    void accountGuest_aMemoryUpdateBeingSavedIsCarriedByTheTransfer() throws Exception {
        UUID member = member();
        Guest guest = guest();
        UUID session = practice(guest.id());
        operation(guest.id(), session, "memory_update", "pending");
        String code = issueCode(guest).path("code").textValue();
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_memory_insert() RETURNS trigger AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock_shared(%d);
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(ISSUE_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_memory_insert
                BEFORE INSERT ON actor_memory_entries
                FOR EACH ROW EXECUTE FUNCTION hold_memory_insert()
                """);
        MemoryUpdateWorker worker = memoryWorker((system, user) ->
                new GeneratedText("{\"goal\":\"새 목표\"}", new TokenUsage(0, 0, 0)));
        Instant now = clock.instant();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            closeIssueGate(gate);
            // 완료 트랜잭션이 작업 행을 잡은 채 기억을 넣다가 문 앞에서 멈춘다.
            Future<Boolean> saving = pool.submit(() -> worker.runOnce(now));
            awaitUntil("the memory write is waiting", 1, this::lockWaiters);
            Future<Integer> moving = pool.submit(() -> transfer(member, code, null).getStatus());
            awaitUntil("the transfer is waiting too", 2, this::lockWaiters);
            openIssueGate(gate);

            assertThat(saving.get()).isTrue();
            assertThat(moving.get()).isEqualTo(200);
            assertThat(jdbc.queryForList(
                    "SELECT value FROM actor_memory_entries WHERE user_id=?", String.class, member))
                    .containsExactly("새 목표");
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM actor_memory_entries WHERE user_id=?", Integer.class, guest.id())).isZero();
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- helpers ----

    private record Guest(UUID id, String accessToken, String refreshToken) {
    }

    /** 웹이 하듯 게스트를 만들고, 동의 하나를 남긴다(동의 기록은 옮겨지지 않는다는 것을 보려고). */
    private Guest guest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.7." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        UUID id = UUID.fromString(body.path("user").path("id").textValue());
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                SELECT gen_random_uuid(),?,id,'granted',now() FROM consent_documents WHERE type='terms'
                """, id);
        return new Guest(id, body.path("access_token").textValue(), body.path("refresh_token").textValue());
    }

    private UUID member() {
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        return member;
    }

    private JsonNode issueCode(Guest guest) throws Exception {
        var response = mvc.perform(post("/v2/guest/transfer-code")
                .header("Authorization", "Bearer " + guest.accessToken())).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse transfer(UUID member, String code, String memoryChoice) throws Exception {
        String body = memoryChoice == null
                ? "{\"code\":\"" + code + "\"}"
                : "{\"code\":\"" + code + "\",\"memory_choice\":\"" + memoryChoice + "\"}";
        String from = address;
        return mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(member).value())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private MemoryUpdateWorker memoryWorker(TextGenerator generator) {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        return new MemoryUpdateWorker(memories, memoryQueue, mapper, generator, clock,
                new MemoryExtractor(reporter), reporter, new RecordingLlmTelemetry());
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 새 코드를 넣는 문장이 문(advisory lock) 앞에서 멈추게 한다 — 실행 순서만 제어하고 결과는 공개 계약에서 본다. */
    private void holdCodeInserts() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_code_insert() RETURNS trigger AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock_shared(%d);
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(ISSUE_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_code_insert
                BEFORE INSERT ON guest_transfer_codes
                FOR EACH ROW EXECUTE FUNCTION hold_code_insert()
                """);
    }

    private void closeIssueGate(Connection gate) throws Exception {
        try (Statement statement = gate.createStatement()) {
            statement.execute("SELECT pg_advisory_lock(" + ISSUE_GATE + ")");
        }
    }

    private void openIssueGate(Connection gate) throws Exception {
        try (Statement statement = gate.createStatement()) {
            statement.execute("SELECT pg_advisory_unlock(" + ISSUE_GATE + ")");
        }
    }

    private int lockWaiters() {
        return jdbc.queryForObject("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                """, Integer.class);
    }

    private int waitingOnCodeTable() {
        return jdbc.queryForObject("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                  AND query LIKE '%guest_transfer_codes%'
                  AND query NOT LIKE '%pg_stat_activity%'
                """, Integer.class);
    }

    private void awaitUntil(String what, int expected, IntSupplier observed) throws Exception {
        Instant deadline = Instant.now().plusSeconds(20);
        while (Instant.now().isBefore(deadline)) {
            if (observed.getAsInt() >= expected) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("timed out: " + what + " (saw " + observed.getAsInt() + " of " + expected + ")");
    }

    private void assertNotFound(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(404);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"transfer_code_not_found\"}"));
    }

    private UUID practice(UUID owner) {
        UUID upload = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',100,now() + interval '1 hour',now())
                """, upload, owner, "videos/" + upload + ".mp4");
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzed','상황','인물','분석','캐릭터 분석','목표')
                """, session, owner, upload);
        return session;
    }

    private UUID operation(UUID owner, UUID session, String kind, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint)
                VALUES (?,?,?,?,?,?,?)
                """, id, session, owner, UUID.randomUUID(), kind, status, "a".repeat(64));
        return id;
    }

    private void memory(UUID owner, String field, String value) {
        jdbc.update("INSERT INTO actor_memory_entries(id,user_id,field,value,written_by) VALUES (?,?,?,?,'actor')",
                UUID.randomUUID(), owner, field, value);
    }

    private UUID owner(String table, UUID id) {
        return jdbc.queryForObject("SELECT user_id FROM " + table + " WHERE id=?", UUID.class, id);
    }
}
