package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class CloudVoiceServiceTest {
    private static final UUID USER = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-01T00:00:00Z");
    private final FakeRepository repository = new FakeRepository();
    private final FakeStorage storage = new FakeStorage();
    private final AtomicInteger calls = new AtomicInteger();
    private final List<String> asked = new CopyOnWriteArrayList<>();
    private final VoiceSynthesizer synthesizer = (text, voice) -> {
        calls.incrementAndGet();
        asked.add(text);
        return new byte[] {1, 2, 3, 4};
    };

    @Test
    void cacheKeySkipsFilesSavedBeforeWavFix() {
        String before = com.acttub.actingapi.platform.web.Hashing.sha256Hex("m\nCharon\n안녕");
        assertThat(CloudVoiceService.hash("m", "Charon", "안녕")).isNotEqualTo(before);
    }

    @Test
    void statusReflectsConsentAndUsage() {
        repository.consent = "granted";
        repository.daily = 12;
        var status = service(settings()).status(USER);
        assertThat(status.available()).isTrue();
        assertThat(status.consent()).isEqualTo("granted");
        assertThat(status.dailyUsed()).isEqualTo(12);
    }

    @Test
    void missingConsentIsForbidden() {
        assertDetail(service(settings()), 403, "cloud_voice_consent_required");
    }

    @Test
    void cacheHitDoesNotSynthesizeOrIncrementEvenAtDailyLimit() {
        repository.consent = "granted";
        repository.daily = 300;
        repository.cached = true;
        var result = service(settings()).synthesize(USER, " hello ", "F1");
        assertThat(result.cached()).isTrue();
        assertThat(calls).hasValue(0);
        assertThat(repository.increments).isZero();
    }

    @Test
    void dailyLimitRejectsCacheMiss() {
        repository.consent = "granted";
        repository.daily = 300;
        assertDetail(service(settings()), 429, "cloud_voice_daily_limit");
    }

    @Test
    void cacheMissSynthesizesOnceStoresWavAndIncrementsUsage() {
        repository.consent = "granted";
        var result = service(settings()).synthesize(USER, " hello ", "F1");
        assertThat(result.cached()).isFalse();
        assertThat(calls).hasValue(1);
        assertThat(repository.increments).isEqualTo(1);
        assertThat(storage.lastKey).startsWith("reading-voice/").endsWith(".wav");
        assertThat(storage.lastBytes).startsWith(new byte[] {'R', 'I', 'F', 'F'});
    }

    @Test
    void longLineIsSynthesizedInSentenceChunksAndJoinedIntoOneWav() {
        repository.consent = "granted";
        String sentence = "가".repeat(79) + ". ";
        String text = sentence.repeat(5).trim();
        var result = service(settings()).synthesize(USER, text, "F1");
        assertThat(result.cached()).isFalse();
        assertThat(asked).hasSize(3).allSatisfy(part -> assertThat(part).hasSizeBetween(1, CloudVoiceService.CHUNK_CHARS).endsWith("."));
        assertThat(String.join(" ", asked)).isEqualTo(text);
        assertThat(repository.increments).isEqualTo(1);
        assertThat(storage.lastBytes).hasSize(44 + 3 * 4);
        assertThat(java.util.Arrays.copyOfRange(storage.lastBytes, 44, 56)).containsExactly(1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4);
    }

    @Test
    void chunksBreakAtSentenceThenSpaceThenHardLimit() {
        assertThat(CloudVoiceService.chunks("짧은 줄.")).containsExactly("짧은 줄.");
        String words = ("가".repeat(99) + " ").repeat(8).trim();
        assertThat(CloudVoiceService.chunks(words)).allSatisfy(part -> assertThat(part).hasSizeLessThanOrEqualTo(CloudVoiceService.CHUNK_CHARS).doesNotStartWith(" ").doesNotEndWith(" "));
        assertThat(String.join(" ", CloudVoiceService.chunks(words))).isEqualTo(words);
        assertThat(CloudVoiceService.chunks("가".repeat(500))).extracting(String::length).containsExactly(200, 200, 100);
        assertThat(CloudVoiceService.chunks("가".repeat(199) + "😀" + "나")).allSatisfy(part -> assertThat(Character.isHighSurrogate(part.charAt(part.length() - 1))).isFalse());
    }

    @Test
    void rejectsEmptyOrOverMaxLine() {
        repository.consent = "granted";
        var target = service(settings());
        for (String text : List.of("  ", "가".repeat(CloudVoiceService.MAX_CHARS + 1))) {
            assertThatThrownBy(() -> target.synthesize(USER, text, "F1"))
                    .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getMessage()).isEqualTo("invalid_voice_request"));
        }
        assertThat(calls).hasValue(0);
    }

    @Test
    void unavailableWhenModelMissingFreePeriodEndedOrMonthlyCapReached() {
        repository.consent = "granted";
        assertDetail(service(new CloudVoiceSettings("", "key", OffsetDateTime.parse("2026-11-30T23:59:59+09:00"), 300, 75_000)), 503, "cloud_voice_unavailable");
        assertDetail(service(new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000)), 503, "cloud_voice_unavailable");
        repository.monthly = 75_000;
        assertDetail(service(settings()), 503, "cloud_voice_unavailable");
    }

    @Test
    void afterFreePeriodOnlyProCanUseAndStatusHidesFreeDate() {
        repository.consent = "granted";
        CloudVoiceSettings ended = new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000);
        CloudVoiceService free = new CloudVoiceService(repository, storage, synthesizer, ended,
                Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> false);
        assertThat(free.status(USER).available()).isFalse();
        assertThat(free.status(USER).freeUntil()).isNull();
        assertDetail(free, 503, "cloud_voice_unavailable");

        CloudVoiceService pro = new CloudVoiceService(repository, storage, synthesizer, ended,
                Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> true);
        assertThat(pro.status(USER).available()).isTrue();
        assertThat(pro.status(USER).freeUntil()).isNull();
        assertThat(pro.synthesize(USER, "안녕하세요.", "F1")).isNotNull();
    }

    @Test
    void duringFreePeriodEveryoneCanUseAndStatusShowsFreeDate() {
        CloudVoiceService target = new CloudVoiceService(repository, storage, synthesizer, settings(),
                Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> false);
        assertThat(target.status(USER).available()).isTrue();
        assertThat(target.status(USER).freeUntil()).isEqualTo(OffsetDateTime.parse("2026-11-30T23:59:59+09:00"));
    }

    @Test
    void proStillRespectsMonthlyCap() {
        repository.monthly = 75_000;
        CloudVoiceSettings ended = new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000);
        CloudVoiceService pro = new CloudVoiceService(repository, storage, synthesizer, ended,
                Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> true);
        assertThat(pro.status(USER).available()).isFalse();
    }

    private CloudVoiceService endedFree() {
        CloudVoiceSettings ended = new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000);
        return new CloudVoiceService(repository, storage, synthesizer, ended, Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> false);
    }

    @Test
    void freeActorGetsTheFirstReadingOfAScriptOnly() {
        repository.consent = "granted";
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        repository.firstSessions.add(first);
        var firstStatus = endedFree().status(USER, null, first);
        assertThat(firstStatus.available()).isTrue();
        assertThat(firstStatus.reason()).isEqualTo("first_reading");
        assertThat(firstStatus.proOnly()).isFalse();
        assertThat(endedFree().synthesize(USER, "안녕하세요.", "F1", first)).isNotNull();

        var secondStatus = endedFree().status(USER, null, second);
        assertThat(secondStatus.available()).isFalse();
        assertThat(secondStatus.reason()).isNull();
        assertThat(secondStatus.proOnly()).isTrue();
        assertThatThrownBy(() -> endedFree().synthesize(USER, "안녕하세요.", "F1", second))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(503));
    }

    @Test
    void scriptWithoutAnySessionYetCountsAsFirstReadingForStatus() {
        UUID script = UUID.randomUUID();
        repository.freshScripts.add(script);
        assertThat(endedFree().status(USER, script, null).reason()).isEqualTo("first_reading");
        assertThat(endedFree().status(USER, UUID.randomUUID(), null).available()).isFalse();
    }

    @Test
    void oldAppRequestsWithoutScriptInfoBehaveAsBefore() {
        repository.firstSessions.add(UUID.randomUUID());
        var status = endedFree().status(USER);
        assertThat(status.available()).isFalse();
        assertThat(status.reason()).isNull();
        assertDetail(endedFree(), 503, "cloud_voice_unavailable");
    }

    @Test
    void firstReadingStillNeedsConsentAndRespectsLimits() {
        UUID first = UUID.randomUUID();
        repository.firstSessions.add(first);
        assertThatThrownBy(() -> endedFree().synthesize(USER, "안녕하세요.", "F1", first))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getMessage()).isEqualTo("cloud_voice_consent_required"));
        repository.consent = "granted";
        repository.daily = 300;
        assertThatThrownBy(() -> endedFree().synthesize(USER, "안녕하세요.", "F1", first))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(429));
        repository.monthly = 75_000;
        assertThat(endedFree().status(USER, null, first).available()).isFalse();
        assertThat(endedFree().status(USER, null, first).proOnly()).isFalse();
    }

    @Test
    void reasonIsProOrFreePeriod() {
        CloudVoiceSettings ended = new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000);
        var pro = new CloudVoiceService(repository, storage, synthesizer, ended, Clock.fixed(NOW, ZoneId.of("Asia/Seoul")), userId -> true);
        assertThat(pro.status(USER).reason()).isEqualTo("pro");
        assertThat(pro.status(USER).proOnly()).isFalse();
        assertThat(service(settings()).status(USER).reason()).isEqualTo("free_period");
    }

    @Test
    void mapsEveryPreset() {
        assertThat(CloudVoiceService.VOICES).containsExactlyEntriesOf(Map.of(
                "M1", "Charon", "M2", "Puck", "M3", "Orus", "M4", "Fenrir", "M5", "Enceladus",
                "F1", "Kore", "F2", "Aoede", "F3", "Leda", "F4", "Zephyr", "F5", "Callirrhoe"));
    }

    // ── SOMA-949: 회차의 다음 상대 대사를 서버가 미리 만들고, 같은 줄은 한 번만 만든다 ──

    private CloudVoiceService withUpcoming(UpcomingVoiceLines upcoming, java.util.concurrent.Executor executor) {
        return new CloudVoiceService(repository, storage, synthesizer, settings(), Clock.fixed(NOW, ZoneId.of("Asia/Seoul")),
                VoicePlan.NONE, upcoming, executor);
    }

    @Test
    void requestWithSessionPreparesNextThreeLinesInBackground() {
        repository.consent = "granted";
        UUID session = UUID.randomUUID();
        List<UpcomingVoiceLines.Line> next = List.of(new UpcomingVoiceLines.Line("둘", "M1"),
                new UpcomingVoiceLines.Line("셋", "F1"), new UpcomingVoiceLines.Line("넷", "M1"));
        List<Integer> counts = new CopyOnWriteArrayList<>();
        var service = withUpcoming((u, s, text, preset, count) -> { counts.add(count); return text.equals("하나") ? next : List.of(); }, Runnable::run);

        var first = service.synthesize(USER, "하나", "F1", session);

        assertThat(first.cached()).isFalse();
        assertThat(counts).containsExactly(CloudVoiceService.LOOKAHEAD_LINES);
        assertThat(asked).containsExactly("하나", "둘", "셋", "넷");
        assertThat(repository.increments).isEqualTo(4);
        // 앱이 다음 줄을 요청하면 미리 만든 것을 바로 준다 — 다시 만들지도, 사용량을 다시 세지도 않는다.
        var second = service.synthesize(USER, "둘", "M1", session);
        assertThat(second.cached()).isTrue();
        assertThat(calls).hasValue(4);
        assertThat(repository.increments).isEqualTo(4);
    }

    @Test
    void cachedLinesAreNotPreparedAgain() {
        repository.consent = "granted";
        UUID session = UUID.randomUUID();
        var service = withUpcoming((u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1")), Runnable::run);
        service.synthesize(USER, "하나", "F1", session);
        service.synthesize(USER, "하나", "F1", session);
        assertThat(asked).containsExactly("하나", "둘");
    }

    @Test
    void requestsWithoutSessionDoNotLookAhead() {
        repository.consent = "granted";
        List<String> looked = new CopyOnWriteArrayList<>();
        var service = withUpcoming((u, s, text, preset, count) -> { looked.add(text); return List.of(); }, Runnable::run);
        service.synthesize(USER, "하나", "F1");
        assertThat(looked).isEmpty();
    }

    @Test
    void lookaheadStopsAtDailyLimit() {
        repository.consent = "granted";
        UUID session = UUID.randomUUID();
        String hash = CloudVoiceService.hash("tts-model", "Kore", "하나");
        repository.rows.put(hash, new CloudVoiceRepository.CacheEntry(hash, "reading-voice/" + hash + ".wav"));
        repository.daily = 300;
        var service = withUpcoming((u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1")), Runnable::run);
        assertThat(service.synthesize(USER, "하나", "F1", session).cached()).isTrue();
        assertThat(calls).hasValue(0);
    }

    @Test
    void lookaheadFollowsTheSameAccessAsTheRequest() {
        repository.consent = "granted";
        repository.monthly = 0;
        UUID first = UUID.randomUUID();
        repository.firstSessions.add(first);
        // 무료 기간이 끝났고 Pro 가 아니어도 첫 리딩 회차는 쓴다 — 미리 만들기도 같은 조건을 따른다.
        CloudVoiceSettings ended = new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000);
        var service = new CloudVoiceService(repository, storage, synthesizer, ended, Clock.fixed(NOW, ZoneId.of("Asia/Seoul")),
                VoicePlan.NONE, (u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1")), Runnable::run);
        service.synthesize(USER, "하나", "F1", first);
        assertThat(asked).containsExactly("하나", "둘");
    }

    @Test
    void lookaheadFailureDoesNotAffectTheRequest() {
        repository.consent = "granted";
        var service = withUpcoming((u, s, text, preset, count) -> { throw new IllegalStateException("db down"); }, Runnable::run);
        assertThat(service.synthesize(USER, "하나", "F1", UUID.randomUUID()).cached()).isFalse();
        assertThat(asked).containsExactly("하나");
    }

    @Test
    void sameLineRequestedTwiceAtOnceIsSynthesizedOnce() throws Exception {
        repository.consent = "granted";
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        AtomicInteger made = new AtomicInteger();
        VoiceSynthesizer slow = (text, voice) -> {
            made.incrementAndGet();
            entered.countDown();
            try { release.await(5, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            return new byte[] {1, 2, 3, 4};
        };
        var service = new CloudVoiceService(repository, storage, slow, settings(), Clock.fixed(NOW, ZoneId.of("Asia/Seoul")));
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var a = pool.submit(() -> service.synthesize(USER, "하나", "F1"));
            assertThat(entered.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            var b = pool.submit(() -> service.synthesize(USER, "하나", "F1"));
            Thread.sleep(100);
            release.countDown();
            assertThat(a.get().audioUrl()).isEqualTo(b.get().audioUrl());
            assertThat(a.get().cached()).isFalse();
            assertThat(b.get().cached()).isTrue();
        }
        assertThat(made).hasValue(1);
        assertThat(repository.increments).isEqualTo(1);
    }

    @Test
    void waitingRequestGetsUnavailableWhenTheSharedSynthesisFails() throws Exception {
        repository.consent = "granted";
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        VoiceSynthesizer failing = (text, voice) -> {
            entered.countDown();
            try { release.await(5, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            throw new IllegalStateException("gemini down");
        };
        var service = new CloudVoiceService(repository, storage, failing, settings(), Clock.fixed(NOW, ZoneId.of("Asia/Seoul")));
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var a = pool.submit(() -> service.synthesize(USER, "하나", "F1"));
            assertThat(entered.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            var b = pool.submit(() -> service.synthesize(USER, "하나", "F1"));
            Thread.sleep(100);
            release.countDown();
            for (var f : List.of(a, b)) {
                assertThatThrownBy(f::get).hasCauseInstanceOf(ApiException.class)
                        .satisfies(e -> assertThat(((ApiException) e.getCause()).status()).isEqualTo(503));
            }
        }
        assertThat(repository.increments).isZero();
    }

    @Test
    void lookaheadIgnoresLinesItCannotSpeak() {
        repository.consent = "granted";
        var service = withUpcoming((u, s, text, preset, count) -> List.of(
                new UpcomingVoiceLines.Line("  ", "M1"), new UpcomingVoiceLines.Line("둘", "X9"),
                new UpcomingVoiceLines.Line(null, "M1"), new UpcomingVoiceLines.Line("셋", null)), Runnable::run);
        service.synthesize(USER, "하나", "F1", UUID.randomUUID());
        assertThat(asked).containsExactly("하나");
    }

    @Test
    void failedLookaheadLineIsLeftForTheApp() {
        repository.consent = "granted";
        VoiceSynthesizer picky = (text, voice) -> {
            if (text.equals("둘")) throw new IllegalStateException("gemini down");
            asked.add(text);
            return new byte[] {1, 2, 3, 4};
        };
        var service = new CloudVoiceService(repository, storage, picky, settings(), Clock.fixed(NOW, ZoneId.of("Asia/Seoul")),
                VoicePlan.NONE, (u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1"),
                        new UpcomingVoiceLines.Line("셋", "M1")), Runnable::run);
        service.synthesize(USER, "하나", "F1", UUID.randomUUID());
        assertThat(asked).containsExactly("하나", "셋");
    }

    @Test
    void closedExecutorDoesNotBreakTheRequest() {
        repository.consent = "granted";
        var service = withUpcoming((u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1")),
                command -> { throw new java.util.concurrent.RejectedExecutionException("shutting down"); });
        assertThat(service.synthesize(USER, "하나", "F1", UUID.randomUUID()).cached()).isFalse();
        assertThat(asked).containsExactly("하나");
    }

    @Test
    void defaultBackgroundRunsLookaheadOffTheRequestThread() throws Exception {
        repository.consent = "granted";
        java.util.concurrent.CountDownLatch prepared = new java.util.concurrent.CountDownLatch(1);
        VoiceSynthesizer counting = (text, voice) -> {
            if (text.equals("둘")) prepared.countDown();
            return new byte[] {1, 2, 3, 4};
        };
        var service = new CloudVoiceService(repository, storage, counting, settings(), Clock.fixed(NOW, ZoneId.of("Asia/Seoul")),
                VoicePlan.NONE, (u, s, text, preset, count) -> List.of(new UpcomingVoiceLines.Line("둘", "M1")), null);
        service.synthesize(USER, "하나", "F1", UUID.randomUUID());
        assertThat(prepared.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
    }

    private CloudVoiceSettings settings() {
        return new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-11-30T23:59:59+09:00"), 300, 75_000);
    }

    private CloudVoiceService service(CloudVoiceSettings settings) {
        return new CloudVoiceService(repository, storage, synthesizer, settings,
                Clock.fixed(NOW, ZoneId.of("Asia/Seoul")));
    }

    private void assertDetail(CloudVoiceService target, int status, String detail) {
        assertThatThrownBy(() -> target.synthesize(USER, "hello", "F1"))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(status);
                    assertThat(error.getMessage()).isEqualTo(detail);
                });
    }

    private static final class FakeRepository implements CloudVoiceRepository {
        String consent = "undecided";
        int daily;
        int monthly;
        boolean cached;
        int increments;
        final Map<String, CacheEntry> rows = new java.util.concurrent.ConcurrentHashMap<>();
        final java.util.Set<UUID> firstSessions = new java.util.HashSet<>();
        final java.util.Set<UUID> freshScripts = new java.util.HashSet<>();
        public boolean firstReadingSession(UUID userId, UUID sessionId) { return firstSessions.contains(sessionId); }
        public boolean firstReadingScript(UUID userId, UUID scriptId) { return freshScripts.contains(scriptId); }
        public String consent(UUID userId) { return consent; }
        public int dailyUsage(UUID userId, java.time.LocalDate day) { return daily; }
        public int monthlyUsage(java.time.YearMonth month) { return monthly; }
        public CacheEntry findCache(String hash) { return cached ? new CacheEntry(hash, "reading-voice/" + hash + ".wav") : rows.get(hash); }
        public synchronized void recordSuccess(UUID userId, java.time.LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now) { rows.put(entry.hash(), entry); increments++; }
    }

    private static final class FakeStorage implements CloudVoiceStorage {
        String lastKey;
        byte[] lastBytes;
        public boolean configured() { return true; }
        public void upload(String key, byte[] wav) { lastKey = key; lastBytes = wav; }
        public String playbackUrl(String key, int expiresInSeconds) { return "https://example.test/" + key; }
    }
}
