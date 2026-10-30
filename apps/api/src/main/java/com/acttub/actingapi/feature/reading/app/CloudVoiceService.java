package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import com.acttub.actingapi.feature.reading.app.CloudVoiceRepository.CacheEntry;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.Hashing;

public final class CloudVoiceService {
    public static final int EXPIRES_IN_SECONDS = 600;
    /** 한 요청의 한도. 화면의 한 줄(한 배역의 연속 대사)이 길 수 있어 나눠 만든다(SOMA-792). */
    public static final int MAX_CHARS = 5_000;
    /** Gemini에 한 번에 보내는 길이. 2026-10-21 실측: 200자 조각을 동시에 보내면 1,199자 줄이 10초, 370자 조각이면 743자 줄이 29~47초(앱 요청 제한 30초). */
    static final int CHUNK_CHARS = 200;
    private static final List<String> BREAKS = List.of(".!?…。！？\n", ",，、;", " ");
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
    private final VoicePlan plan;

    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock) {
        this(repository, storage, synthesizer, settings, clock, VoicePlan.NONE);
    }

    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock, VoicePlan plan) {
        this.repository = repository; this.storage = storage; this.synthesizer = synthesizer;
        this.settings = settings; this.clock = clock; this.plan = plan == null ? VoicePlan.NONE : plan;
    }

    public Status status(UUID userId) {
        return status(userId, null, null);
    }

    /**
     * 대본 정보(scriptId 또는 회차 sessionId)가 있으면 무료 배우의 「대본마다 첫 리딩」도 가려 준다(SOMA-917).
     * 둘 다 있으면 회차가 먼저다. 없으면(옛 앱) 예전과 똑같다.
     */
    public Status status(UUID userId, UUID scriptId, UUID sessionId) {
        LocalDate today = LocalDate.now(clock.withZone(SEOUL));
        boolean pro = plan.pro(userId);
        Access access = access(userId, scriptId, sessionId, pro);
        return new Status(access.available(), inFreePeriod() ? settings.freeUntil() : null, repository.consent(userId),
                pro ? settings.proMonthlyLineCap() : settings.dailyLineCap(),
                pro ? repository.monthlyUsage(userId, YearMonth.from(today)) : repository.dailyUsage(userId, today),
                access.reason(), access == Access.PRO_ONLY);
    }

    public Result synthesize(UUID userId, String rawText, String preset) {
        return synthesize(userId, rawText, preset, null);
    }

    public Result synthesize(UUID userId, String rawText, String preset, UUID sessionId) {
        String text = rawText == null ? "" : rawText.trim();
        String voice = preset == null ? null : VOICES.get(preset);
        if (text.isEmpty() || text.length() > MAX_CHARS || voice == null) throw new ApiException(400, "invalid_voice_request");
        boolean pro = plan.pro(userId);
        if (!access(userId, null, sessionId, pro).available()) throw unavailable(null);
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
        if (pro) {
            if (repository.monthlyUsage(userId, YearMonth.from(today)) >= settings.proMonthlyLineCap())
                throw new ApiException(429, "cloud_voice_monthly_limit");
        } else if (repository.dailyUsage(userId, today) >= settings.dailyLineCap()) {
            throw new ApiException(429, "cloud_voice_daily_limit");
        }
        boolean recorded;
        CacheEntry entry = new CacheEntry(hash, "reading-voice/" + hash + ".wav");
        try {
            byte[] wav = synthesizeChunks(text, voice);
            storage.upload(entry.objectKey(), wav);
            if (pro) recorded = repository.recordSuccessWithinMonthlyCap(userId, today, entry, settings.model(), voice,
                    wav.length, clock.instant(), settings.proMonthlyLineCap());
            else {
                repository.recordSuccess(userId, today, entry, settings.model(), voice, wav.length, clock.instant());
                recorded = true;
            }
        } catch (RuntimeException error) {
            throw unavailable(error);
        }
        if (!recorded) throw new ApiException(429, "cloud_voice_monthly_limit");
        try {
            return result(entry.objectKey(), false);
        } catch (RuntimeException error) {
            throw unavailable(error);
        }
    }

    /** 긴 줄은 문장 단위로 나눠 동시에 만들고 하나의 WAV로 잇는다. 사용량은 화면의 줄 하나로 센다. */
    private byte[] synthesizeChunks(String text, String voice) {
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<byte[]>> parts = chunks(text).stream()
                    .map(part -> pool.submit(() -> synthesizer.synthesizePcm(part, voice))).toList();
            List<byte[]> audio = new ArrayList<>();
            for (Future<byte[]> part : parts) audio.add(part.get());
            return WavPcm.join(audio);
        } catch (ExecutionException error) {
            throw error.getCause() instanceof RuntimeException cause ? cause : new IllegalStateException(error.getCause());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(error);
        }
    }

    /** {@link #CHUNK_CHARS} 이하로 자른다. 문장 끝, 없으면 쉼표, 띄어쓰기 순으로 자를 곳을 찾고 그래도 없으면 한도에서 자른다. */
    static List<String> chunks(String text) {
        List<String> out = new ArrayList<>();
        String rest = text;
        while (rest.length() > CHUNK_CHARS) {
            int cut = breakBefore(rest);
            out.add(rest.substring(0, cut).trim());
            rest = rest.substring(cut).trim();
        }
        out.add(rest);
        return out;
    }

    private static int breakBefore(String text) {
        for (String marks : BREAKS) {
            for (int at = CHUNK_CHARS; at > CHUNK_CHARS / 2; at--) {
                if (marks.indexOf(text.charAt(at - 1)) >= 0) return at;
            }
        }
        return Character.isHighSurrogate(text.charAt(CHUNK_CHARS - 1)) ? CHUNK_CHARS - 1 : CHUNK_CHARS;
    }

    /**
     * 무료 기간({@code READING_VOICE_FREE_UNTIL}) 안에는 누구나, 그 뒤에는 Pro 만 쓴다(2026-11-01부터 Pro 혜택).
     * 무료 배우도 (배우, 대본)마다 가장 먼저 시작한 리딩 회차 하나는 쓴다(SOMA-917) — 서버가 회차 표로 가리고 앱 값은 믿지 않는다.
     * Pro는 계정별 월 한도를 따로 적용하고, 일반 계정만 기존 서비스 전체 월 한도를 지킨다.
     */
    private Access access(UUID userId, UUID scriptId, UUID sessionId, boolean pro) {
        if (!settings.modelConfigured() || !storage.configured()) return Access.NONE;
        if (pro) return inFreePeriod() ? Access.FREE_PERIOD : Access.PRO;
        if (repository.monthlyUsage(YearMonth.from(LocalDate.now(clock.withZone(SEOUL)))) >= settings.monthlyLineCap()) return Access.NONE;
        if (inFreePeriod()) return Access.FREE_PERIOD;
        boolean first = sessionId != null ? repository.firstReadingSession(userId, sessionId)
                : scriptId != null && repository.firstReadingScript(userId, scriptId);
        return first ? Access.FIRST_READING : Access.PRO_ONLY;
    }

    private enum Access {
        NONE(null), FREE_PERIOD("free_period"), PRO("pro"), FIRST_READING("first_reading"), PRO_ONLY(null);
        private final String reason;
        Access(String reason) { this.reason = reason; }
        String reason() { return reason; }
        boolean available() { return reason != null; }
    }

    private boolean inFreePeriod() {
        return settings.freeUntil() != null && !clock.instant().isAfter(settings.freeUntil().toInstant());
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

    /** dailyLimit/dailyUsed는 구버전 호환 필드다. Pro에게는 한국 달력 월의 한도·사용량을 담는다. */
    public record Status(boolean available, java.time.OffsetDateTime freeUntil, String consent, int dailyLimit, int dailyUsed,
            String reason, boolean proOnly) {}
    public record Result(String audioUrl, boolean cached, int expiresIn) {}
}
