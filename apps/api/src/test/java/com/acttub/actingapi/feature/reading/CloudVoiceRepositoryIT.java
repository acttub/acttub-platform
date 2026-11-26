package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository;
import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository.CacheEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 고품질 목소리 저장소가 내는 결과·잠금·경합·문장을 고정한다. 동의·한도·합성의 HTTP 흐름은 {@link CloudVoiceIT} 가 본다.
 * 여기서는 그 테스트가 밟지 않는 달의 경계, 첫 회차를 고르는 둘째 기준, 저장 확인의 빈 목록과 겹친 해시, 월 한도 차감의 계정별
 * 직렬화(권고 잠금)와 두 요청이 마지막 한 줄을 다툴 때의 결과, 포트 메서드마다 나가는 문장을 본다.
 */
class CloudVoiceRepositoryIT extends ReadingRepositoryFixture {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 25);

    @Autowired
    CloudVoiceRepository voices;

    private UUID owner;

    @BeforeEach
    void setUp() {
        owner = member();
        jdbc.update("DELETE FROM reading_voice_cache");
    }

    @Test
    @DisplayName("dailyUsage·monthlyUsage: 그 사람의 그날 줄 수, 그 달(1일부터 다음 달 1일 전까지)의 줄 수, 모든 사람의 그 달 줄 수를 낸다. 기록이 없으면 0 이다")
    void usageSumsByDayAndMonth() {
        UUID other = member();
        usage(owner, LocalDate.of(2026, 10, 31), 100);
        usage(owner, LocalDate.of(2026, 11, 1), 3);
        usage(owner, DAY, 5);
        usage(owner, LocalDate.of(2026, 11, 30), 7);
        usage(owner, LocalDate.of(2026, 12, 1), 200);
        usage(other, DAY, 11);

        assertThat(voices.dailyUsage(owner, DAY)).isEqualTo(5);
        assertThat(voices.dailyUsage(owner, DAY.plusDays(1))).isZero();
        assertThat(voices.monthlyUsage(owner, YearMonth.of(2026, 11))).isEqualTo(15);
        assertThat(voices.monthlyUsage(YearMonth.of(2026, 11))).isEqualTo(26);
        assertThat(voices.monthlyUsage(owner, YearMonth.of(2027, 1))).isZero();
        assertThat(voices.monthlyUsage(YearMonth.of(2027, 1))).isZero();
    }

    @Test
    @DisplayName("firstReadingSession: 그 사람이 가장 먼저 시작한 회차(같은 시각이면 id 가 작은 것)만 true 다. 남의 회차·없는 회차는 false 다")
    void firstReadingSessionIsTheEarliestOne() {
        UUID script = script(owner);
        UUID line = line(script, 1, "dialogue", character(script, "니나", 0), "안녕");
        UUID first = sessionAt(owner, script, line, 1, now);
        UUID tie = sessionAt(owner, script, line, 2, now);
        UUID later = sessionAt(owner, script, line, 3, now.plusSeconds(60));
        UUID otherScript = script(owner);
        UUID otherLine = line(otherScript, 1, "dialogue", character(otherScript, "니나", 0), "안녕");
        UUID earlierElsewhere = sessionAt(member(), otherScript, otherLine, 4, now.minusSeconds(60));

        assertThat(voices.firstReadingSession(owner, first)).isTrue();
        assertThat(voices.firstReadingSession(owner, tie)).isFalse();
        assertThat(voices.firstReadingSession(owner, later)).isFalse();
        assertThat(voices.firstReadingSession(owner, earlierElsewhere)).as("남의 회차").isFalse();
        assertThat(voices.firstReadingSession(owner, UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("firstReadingScript: 내 대본이고 내 회차가 아직 하나도 없을 때만 true 다")
    void firstReadingScriptNeedsNoSessionYet() {
        UUID script = script(owner);
        UUID line = line(script, 1, "dialogue", character(script, "니나", 0), "안녕");
        UUID stranger = member();

        assertThat(voices.firstReadingScript(owner, script)).isTrue();
        assertThat(voices.firstReadingScript(stranger, script)).as("남의 대본").isFalse();
        assertThat(voices.firstReadingScript(owner, UUID.randomUUID())).isFalse();

        session(owner, script, line, line);
        assertThat(voices.firstReadingScript(owner, script)).as("회차가 생겼다").isFalse();
        assertThat(voices.firstReadingScript(owner, script(owner))).as("다른 대본이어도 회차가 있으면 아니다").isFalse();
    }

    @Test
    @DisplayName("findCache·allCached: 저장된 해시면 객체 키와 함께 낸다. allCached 는 모두 있을 때만 true 이고 빈 목록은 false, 겹친 해시는 하나로 센다")
    void cacheLookups() {
        voices.recordSuccess(owner, DAY, entry("a"), "model", "Kore", 10, now);
        voices.recordSuccess(owner, DAY, entry("b"), "model", "Kore", 10, now);

        assertThat(voices.findCache(hash("a"))).isEqualTo(new CacheEntry(hash("a"), "reading-voice/" + hash("a") + ".wav"));
        assertThat(voices.findCache(hash("z"))).isNull();
        assertThat(voices.allCached(List.of())).isFalse();
        assertThat(voices.allCached(List.of(hash("a"), hash("b")))).isTrue();
        assertThat(voices.allCached(List.of(hash("a"), hash("a"), hash("b")))).isTrue();
        assertThat(voices.allCached(List.of(hash("a"), hash("z")))).isFalse();
    }

    @Test
    @DisplayName("recordSuccess: 새 해시면 저장 기록을 남기고 그날 줄 수를 하나 올린다. 이미 저장된 해시면 아무것도 바꾸지 않는다")
    void recordSuccessChargesOncePerHash() {
        voices.recordSuccess(owner, DAY, entry("a"), "model-1", "Kore", 1234, now.plusNanos(1_500));
        voices.recordSuccess(owner, DAY, entry("b"), "model-1", "Kore", 10, now);
        voices.recordSuccess(member(), DAY, entry("a"), "model-2", "Puck", 99, now.plusSeconds(60));

        assertThat(jdbc.queryForMap("SELECT model,voice,byte_size FROM reading_voice_cache WHERE hash=?", hash("a")))
                .containsEntry("model", "model-1").containsEntry("voice", "Kore").containsEntry("byte_size", 1234);
        assertThat(instant("SELECT created_at FROM reading_voice_cache WHERE hash=?", hash("a")))
                .isEqualTo(now.plus(2, java.time.temporal.ChronoUnit.MICROS));
        assertThat(voices.dailyUsage(owner, DAY)).isEqualTo(2);
        assertThat(count("reading_voice_usage")).as("이미 저장된 해시를 다시 만든 사람에게는 차감하지 않는다").isEqualTo(1);
    }

    @Test
    @DisplayName("recordSuccessWithinMonthlyCap: 그 달 한도 안이면 기록하고 true, 한도에 닿았으면 기록하지 않고 false 다. 이미 저장된 해시는 한도와 상관없이 차감 없이 true 다")
    void recordWithinTheMonthlyCap() {
        usage(owner, LocalDate.of(2026, 11, 1), 2);

        assertThat(voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("a"), "model", "Kore", 10, now, 3)).isTrue();
        assertThat(voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("b"), "model", "Kore", 10, now, 3)).isFalse();
        assertThat(voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("a"), "model", "Kore", 10, now, 3)).isTrue();

        assertThat(voices.monthlyUsage(owner, YearMonth.of(2026, 11))).isEqualTo(3);
        assertThat(voices.findCache(hash("b"))).isNull();
    }

    @Test
    @DisplayName("recordSuccessWithinMonthlyCap 은 계정마다 권고 잠금으로 줄을 세운다 — 바깥 연결이 그 계정의 잠금을 쥐고 있으면 기다리고 다른 계정은 기다리지 않는다")
    void theMonthlyCapIsSerializedPerAccount() throws Exception {
        UUID other = member();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "reading_voice_monthly:" + owner);

            assertThat(pool.submit(() -> voices.recordSuccessWithinMonthlyCap(other, DAY, entry("o"), "model", "Kore", 10, now, 3))
                    .get(20, TimeUnit.SECONDS)).as("다른 계정").isTrue();
            Future<Boolean> blocked = pool.submit(() ->
                    voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("a"), "model", "Kore", 10, now, 3));
            String waiting = awaitWaiting("pg_advisory_xact_lock");
            assertThat(voices.findCache(hash("a"))).as("기다리는 동안 기록하지 않았다").isNull();
            probe.rollback();

            assertThat(waiting).startsWith("select");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("두 요청이 그 달의 마지막 한 줄을 함께 노리면 뒤의 것이 앞의 커밋을 기다렸다가 한도를 다시 보고 false 다 — 한 줄만 기록된다")
    void twoRequestsForTheLastLineOfTheMonth() throws Exception {
        usage(owner, LocalDate.of(2026, 11, 1), 2);
        CountDownLatch recorded = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> first = pool.submit(() -> inTransaction(() -> {
                boolean won = voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("a"), "model", "Kore", 10, now, 3);
                recorded.countDown();
                await(release);
                return won;
            }));
            await(recorded);
            Future<Boolean> second = pool.submit(() ->
                    voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("b"), "model", "Kore", 10, now, 3));
            awaitWaiting("pg_advisory_xact_lock");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            pool.shutdownNow();
        }
        assertThat(voices.monthlyUsage(owner, YearMonth.of(2026, 11))).isEqualTo(3);
        assertThat(jdbc.queryForList("SELECT hash FROM reading_voice_cache", String.class)).containsExactly(hash("a"));
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 읽기는 모두 한 문장이다. 월 한도 차감은 권고 잠금·저장 확인·그 달 줄 수·기록이고, 이미 저장됐으면 저장 확인에서, 한도에 닿았으면 줄 수에서 멈춘다")
    void eachPortMethodSendsTheseStatements() {
        UUID script = script(owner);
        String usage = "select reading_voice_usage";
        String cache = "select reading_voice_cache";
        String record = "insert reading_voice_cache on conflict returning";

        assertThat(statementsOf(() -> voices.dailyUsage(owner, DAY))).containsExactly(usage);
        assertThat(statementsOf(() -> voices.monthlyUsage(owner, YearMonth.of(2026, 11)))).containsExactly(usage);
        assertThat(statementsOf(() -> voices.monthlyUsage(YearMonth.of(2026, 11)))).containsExactly(usage);
        assertThat(statementsOf(() -> voices.firstReadingSession(owner, UUID.randomUUID()))).containsExactly("select (표 없음)");
        assertThat(statementsOf(() -> voices.firstReadingScript(owner, script))).containsExactly("select (표 없음)");
        assertThat(statementsOf(() -> voices.findCache(hash("a")))).containsExactly(cache);
        assertThat(statementsOf(() -> voices.allCached(List.of(hash("a"))))).containsExactly("count reading_voice_cache");
        assertThat(statementsOf(() -> voices.recordSuccess(owner, DAY, entry("a"), "model", "Kore", 10, now)))
                .containsExactly(record);
        assertThat(statementsOf(() -> voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("b"), "model", "Kore", 10, now, 9)))
                .containsExactly("advisory lock", cache, usage, record);
        assertThat(statementsOf(() -> voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("b"), "model", "Kore", 10, now, 9)))
                .as("이미 저장됐다").containsExactly("advisory lock", cache);
        assertThat(statementsOf(() -> voices.recordSuccessWithinMonthlyCap(owner, DAY, entry("c"), "model", "Kore", 10, now, 2)))
                .as("한도에 닿았다").containsExactly("advisory lock", cache, usage);
    }

    private void usage(UUID user, LocalDate day, int lines) {
        jdbc.update("INSERT INTO reading_voice_usage(user_id,day,lines) VALUES (?,?,?)", user, day, lines);
    }

    private static String hash(String seed) {
        return seed.repeat(64);
    }

    private static CacheEntry entry(String seed) {
        return new CacheEntry(hash(seed), "reading-voice/" + hash(seed) + ".wav");
    }

    /** @param n id 의 끝 자리 — 같은 시각일 때의 순서를 정한다 */
    private UUID sessionAt(UUID user, UUID script, UUID line, int n, java.time.Instant startedAt) {
        UUID id = UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
        UUID made = session(user, script, line, line);
        jdbc.update("UPDATE reading_sessions SET id=?, started_at=? WHERE id=?", id, utc(startedAt), made);
        return id;
    }
}
