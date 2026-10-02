package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class CloudVoiceServiceTest {
    private static final UUID USER = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-01T00:00:00Z");
    private final FakeRepository repository = new FakeRepository();
    private final FakeStorage storage = new FakeStorage();
    private final AtomicInteger calls = new AtomicInteger();
    private final VoiceSynthesizer synthesizer = (text, voice) -> {
        calls.incrementAndGet();
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
    void unavailableWhenModelMissingFreePeriodEndedOrMonthlyCapReached() {
        repository.consent = "granted";
        assertDetail(service(new CloudVoiceSettings("", "key", OffsetDateTime.parse("2026-11-30T23:59:59+09:00"), 300, 75_000)), 503, "cloud_voice_unavailable");
        assertDetail(service(new CloudVoiceSettings("tts-model", "key", OffsetDateTime.parse("2026-09-30T23:59:59+09:00"), 300, 75_000)), 503, "cloud_voice_unavailable");
        repository.monthly = 75_000;
        assertDetail(service(settings()), 503, "cloud_voice_unavailable");
    }

    @Test
    void mapsEveryPreset() {
        assertThat(CloudVoiceService.VOICES).containsExactlyEntriesOf(Map.of(
                "M1", "Charon", "M2", "Puck", "M3", "Orus", "M4", "Fenrir", "M5", "Enceladus",
                "F1", "Kore", "F2", "Aoede", "F3", "Leda", "F4", "Zephyr", "F5", "Callirrhoe"));
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
        final Map<String, CacheEntry> rows = new HashMap<>();
        public String consent(UUID userId) { return consent; }
        public int dailyUsage(UUID userId, java.time.LocalDate day) { return daily; }
        public int monthlyUsage(java.time.YearMonth month) { return monthly; }
        public CacheEntry findCache(String hash) { return cached ? new CacheEntry(hash, "reading-voice/" + hash + ".wav") : rows.get(hash); }
        public void recordSuccess(UUID userId, java.time.LocalDate day, CacheEntry entry, String model, String voice, int byteSize, Instant now) { rows.put(entry.hash(), entry); increments++; }
    }

    private static final class FakeStorage implements CloudVoiceStorage {
        String lastKey;
        byte[] lastBytes;
        public boolean configured() { return true; }
        public void upload(String key, byte[] wav) { lastKey = key; lastBytes = wav; }
        public String playbackUrl(String key, int expiresInSeconds) { return "https://example.test/" + key; }
    }
}
