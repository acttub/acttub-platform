package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository.CacheEntry;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.Hashing;

public final class CloudVoiceService {
    public static final int EXPIRES_IN_SECONDS = 600;
    public static final Map<String, String> VOICES;
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String CACHE_FORMAT = "wav2";
    static {
        Map<String, String> voices = new LinkedHashMap<>();
        voices.put("M1", "Charon"); voices.put("M2", "Puck"); voices.put("M3", "Orus");
        voices.put("M4", "Fenrir"); voices.put("M5", "Enceladus"); voices.put("F1", "Kore");
        voices.put("F2", "Aoede"); voices.put("F3", "Leda"); voices.put("F4", "Zephyr"); voices.put("F5", "Callirrhoe");
        VOICES = Map.copyOf(voices);
    }

    private final CloudVoiceRepository repository;
    private final CloudVoiceStorage storage;
    private final VoiceSynthesizer synthesizer;
    private final CloudVoiceSettings settings;
    private final Clock clock;

    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock) {
        this.repository = repository; this.storage = storage; this.synthesizer = synthesizer;
        this.settings = settings; this.clock = clock;
    }

    public Status status(UUID userId) {
        LocalDate today = LocalDate.now(clock.withZone(SEOUL));
        return new Status(available(), settings.freeUntil(), repository.consent(userId),
                settings.dailyLineCap(), repository.dailyUsage(userId, today));
    }

    public Result synthesize(UUID userId, String rawText, String preset) {
        String text = rawText == null ? "" : rawText.trim();
        String voice = VOICES.get(preset);
        if (text.isEmpty() || text.length() > 500 || voice == null) throw new ApiException(400, "invalid_voice_request");
        if (!available()) throw unavailable(null);
        if (!"granted".equals(repository.consent(userId))) throw new ApiException(403, "cloud_voice_consent_required");
        String hash = hash(settings.model(), voice, text);
        CacheEntry cached = repository.findCache(hash);
        if (cached != null) {
            try {
                return result(cached.objectKey(), true);
            } catch (RuntimeException error) {
                throw unavailable(error);
            }
        }
        LocalDate today = LocalDate.now(clock.withZone(SEOUL));
        if (repository.dailyUsage(userId, today) >= settings.dailyLineCap()) throw new ApiException(429, "cloud_voice_daily_limit");
        try {
            byte[] wav = WavPcm.wrap(synthesizer.synthesizePcm(text, voice));
            CacheEntry entry = new CacheEntry(hash, "reading-voice/" + hash + ".wav");
            storage.upload(entry.objectKey(), wav);
            repository.recordSuccess(userId, today, entry, settings.model(), voice, wav.length, clock.instant());
            return result(entry.objectKey(), false);
        } catch (RuntimeException error) {
            throw unavailable(error);
        }
    }

    private boolean available() {
        if (!settings.modelConfigured() || !storage.configured() || settings.freeUntil() == null) return false;
        if (clock.instant().isAfter(settings.freeUntil().toInstant())) return false;
        return repository.monthlyUsage(YearMonth.from(LocalDate.now(clock.withZone(SEOUL)))) < settings.monthlyLineCap();
    }

    private Result result(String objectKey, boolean cached) {
        return new Result(storage.playbackUrl(objectKey, EXPIRES_IN_SECONDS), cached, EXPIRES_IN_SECONDS);
    }

    private static ApiException unavailable(Throwable cause) {
        return ApiException.external(503, "cloud_voice_unavailable",
                cause == null ? new IllegalStateException("cloud voice is unavailable") : cause);
    }

    /**
     * 캐시 키. 끝의 {@link #CACHE_FORMAT}은 저장 파일 형식의 판이다 — 2026-10-01~02에 WAV를 두 번 싸서
     * 저장한 파일(틱·지지직)을 다시 내주지 않으려고 올렸다.
     */
    static String hash(String model, String voice, String text) {
        return Hashing.sha256Hex(model + "\n" + voice + "\n" + text + "\n" + CACHE_FORMAT);
    }

    public record Status(boolean available, java.time.OffsetDateTime freeUntil, String consent, int dailyLimit, int dailyUsed) {}
    public record Result(String audioUrl, boolean cached, int expiresIn) {}
}
