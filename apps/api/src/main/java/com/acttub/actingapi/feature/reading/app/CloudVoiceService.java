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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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
    private final UpcomingVoiceLines upcoming;
    private final Executor background;
    /**
     * 지금 만들고 있는 음성(캐시 열쇠 → 결과). 같은 줄을 앱과 미리 만들기가 동시에 요청해도 Gemini 는 한 번만 부른다(SOMA-949).
     * 서버 한 대 안에서만 막는다 — 배포 중 두 대가 겹치는 잠깐은 같은 줄을 두 번 만들 수 있다.
     */
    private final Map<String, CompletableFuture<CacheEntry>> making = new ConcurrentHashMap<>();

    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock) {
        this(repository, storage, synthesizer, settings, clock, VoicePlan.NONE);
    }

    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock, VoicePlan plan) {
        this(repository, storage, synthesizer, settings, clock, plan, UpcomingVoiceLines.NONE, null);
    }

    /**
     * @param upcoming 회차에서 방금 요청한 줄 뒤의 상대 대사를 찾는다 — 그 줄들을 미리 만들어 둔다(SOMA-949)
     * @param background 미리 만들기를 돌릴 곳. {@code null} 이면 가상 스레드
     */
    public CloudVoiceService(CloudVoiceRepository repository, CloudVoiceStorage storage,
            VoiceSynthesizer synthesizer, CloudVoiceSettings settings, Clock clock, VoicePlan plan,
            UpcomingVoiceLines upcoming, Executor background) {
        this.repository = repository; this.storage = storage; this.synthesizer = synthesizer;
        this.settings = settings; this.clock = clock; this.plan = plan == null ? VoicePlan.NONE : plan;
        this.upcoming = upcoming == null ? UpcomingVoiceLines.NONE : upcoming;
        this.background = background == null ? Executors.newVirtualThreadPerTaskExecutor() : background;
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
        Access access = access(userId, scriptId, sessionId);
        return new Status(access.available(), inFreePeriod() ? settings.freeUntil() : null, repository.consent(userId),
                settings.dailyLineCap(), repository.dailyUsage(userId, today), access.reason(), access == Access.PRO_ONLY);
    }

    public Result synthesize(UUID userId, String rawText, String preset) {
        return synthesize(userId, rawText, preset, null);
    }

    public Result synthesize(UUID userId, String rawText, String preset, UUID sessionId) {
        String text = rawText == null ? "" : rawText.trim();
        String voice = preset == null ? null : VOICES.get(preset);
        if (text.isEmpty() || text.length() > MAX_CHARS || voice == null) throw new ApiException(400, "invalid_voice_request");
        if (!access(userId, null, sessionId).available()) throw unavailable(null);
        if (!"granted".equals(repository.consent(userId))) throw new ApiException(403, "cloud_voice_consent_required");
        String hash = hash(settings.model(), voice, text);
        CacheEntry cached = repository.findCache(hash);
        Result result;
        if (cached != null) {
            try {
                result = result(cached.objectKey(), true);
            } catch (RuntimeException error) {
                throw unavailable(error);
            }
        } else {
            CompletableFuture<CacheEntry> other = making.get(hash);
            // 미리 만들기가 이미 이 줄을 만드는 중이면 기다렸다 그것을 준다 — 사용량은 그쪽이 이미 셌다.
            if (other != null) {
                result = result(await(other).objectKey(), true);
            } else {
                LocalDate today = LocalDate.now(clock.withZone(SEOUL));
                if (repository.dailyUsage(userId, today) >= settings.dailyLineCap()) throw new ApiException(429, "cloud_voice_daily_limit");
                Made made = make(userId, hash, text, voice);
                result = result(made.entry().objectKey(), !made.mine());
            }
        }
        prepareNext(userId, sessionId, text, preset);
        return result;
    }

    /** 만든 음성과, 이 요청이 직접 만들었는지(아니면 다른 요청이 만든 것을 받았는지). */
    private record Made(CacheEntry entry, boolean mine) {}

    /** 이 줄을 만든다. 같은 줄을 누가 이미 만들고 있으면 새로 만들지 않고 그 결과를 기다린다. */
    private Made make(UUID userId, String hash, String text, String voice) {
        CompletableFuture<CacheEntry> mine = new CompletableFuture<>();
        CompletableFuture<CacheEntry> other = making.putIfAbsent(hash, mine);
        if (other != null) return new Made(await(other), false);
        try {
            byte[] wav = synthesizeChunks(text, voice);
            CacheEntry entry = new CacheEntry(hash, "reading-voice/" + hash + ".wav");
            storage.upload(entry.objectKey(), wav);
            repository.recordSuccess(userId, LocalDate.now(clock.withZone(SEOUL)), entry, settings.model(), voice, wav.length, clock.instant());
            mine.complete(entry);
            return new Made(entry, true);
        } catch (RuntimeException error) {
            mine.completeExceptionally(error);
            throw unavailable(error);
        } finally {
            making.remove(hash, mine);
        }
    }

    /** 앱 요청 제한(30초)보다 조금 짧게 기다린다. */
    private static CacheEntry await(CompletableFuture<CacheEntry> other) {
        try {
            return other.get(25, TimeUnit.SECONDS);
        } catch (ExecutionException error) {
            throw unavailable(error.getCause());
        } catch (TimeoutException error) {
            throw unavailable(error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw unavailable(error);
        }
    }

    /** 방금 요청한 줄 뒤로 미리 만들어 둘 상대 대사 수(SOMA-949). */
    static final int LOOKAHEAD_LINES = 3;

    /**
     * 회차에서 이 줄 다음에 나올 상대 대사 {@link #LOOKAHEAD_LINES}줄을 뒤에서 동시에 만들어 둔다(SOMA-949). 1.1.0 앱은 한 줄씩
     * 차례로 요청해서 상대 대사가 이어지거나 빨리 넘기면 준비가 늦었다 — 서버가 앞서 만들어 두면 다음 요청은 저장본을 바로 받는다.
     * 응답을 늦추지 않고, 실패해도 아무 영향이 없다(그 줄은 앱이 요청할 때 평소처럼 만든다). 사용 조건·하루 한도는 앱 요청과 같다.
     */
    private void prepareNext(UUID userId, UUID sessionId, String text, String preset) {
        if (sessionId == null || upcoming == UpcomingVoiceLines.NONE) return;
        try {
            background.execute(() -> {
                try {
                    List<UpcomingVoiceLines.Line> next = upcoming.after(userId, sessionId, text, preset, LOOKAHEAD_LINES);
                    if (next.isEmpty() || !access(userId, null, sessionId).available()) return;
                    for (UpcomingVoiceLines.Line line : next) background.execute(() -> prepare(userId, line));
                } catch (RuntimeException ignored) {
                    // 미리 만들기는 덤이다 — 앱 요청이 평소처럼 만든다.
                }
            });
        } catch (RuntimeException ignored) {
            // 실행기가 닫혔으면(종료 중) 미리 만들지 않는다.
        }
    }

    private void prepare(UUID userId, UpcomingVoiceLines.Line line) {
        try {
            String text = line.text() == null ? "" : line.text().trim();
            String voice = line.preset() == null ? null : VOICES.get(line.preset());
            if (text.isEmpty() || text.length() > MAX_CHARS || voice == null) return;
            String hash = hash(settings.model(), voice, text);
            if (making.containsKey(hash) || repository.findCache(hash) != null) return;
            if (repository.dailyUsage(userId, LocalDate.now(clock.withZone(SEOUL))) >= settings.dailyLineCap()) return;
            make(userId, hash, text, voice);
        } catch (RuntimeException ignored) {
            // 실패한 줄은 앱이 요청할 때 다시 만든다.
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
     * 모델·저장소 설정과 월 한도는 어느 경우에도 늘 지킨다.
     */
    private Access access(UUID userId, UUID scriptId, UUID sessionId) {
        if (!settings.modelConfigured() || !storage.configured()) return Access.NONE;
        if (repository.monthlyUsage(YearMonth.from(LocalDate.now(clock.withZone(SEOUL)))) >= settings.monthlyLineCap()) return Access.NONE;
        if (inFreePeriod()) return Access.FREE_PERIOD;
        if (plan.pro(userId)) return Access.PRO;
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

    public record Status(boolean available, java.time.OffsetDateTime freeUntil, String consent, int dailyLimit, int dailyUsed,
            String reason, boolean proOnly) {}
    public record Result(String audioUrl, boolean cached, int expiresIn) {}
}
