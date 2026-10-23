package com.acttub.actingapi.feature.coach.app;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * 한 대화 안에서 Gemini에 올린 영상을 다시 쓴다(SOMA-735).
 *
 * <p>예전에는 배우가 답할 때마다 같은 영상을 내려받아 Gemini에 다시 올리고 처리가 끝나길 기다린 뒤 지웠다. 운영 서버에서 68초
 * 영상으로 재 보니 올리기 3.7초 + 처리 대기 4.1초로, 답 하나 대기(중간값 17.6초)의 절반 가까이였다. 그래서 대화가 이어지는 동안은
 * 처음 올린 영상을 서버 메모리에 기억해 두고 다시 쓴다.
 *
 * <p>지우는 때: 대화가 닫히거나 답이 실패하면 바로, 마지막으로 쓴 뒤 {@code idle} 동안 다시 쓰지 않으면.
 * 원본(저장소 키·etag)이 바뀌면 옛 영상을 지우고 다시 올린다.
 * {@code idle} 이 0 이면 아무것도 기억하지 않는다 — 예전처럼 답마다 올리고 지운다(롤백).
 *
 * <p>SOMA-780에서 두 가지를 더했다.
 * <ul>
 *   <li><b>미리 준비</b>({@link #warm}·{@link #claimWarm}): 분석 작업이 원본을 내려받은 직후 소리 검사·올리기·처리 대기를
 *   시작해 두고, 첫 질문은 그 결과를 기다려 쓴다. 앱이 '분석 중' 화면에서 기다리는 시간과 겹치게 하려는 것이다.</li>
 *   <li><b>배포해도 유지</b>({@code scope} 가 있을 때): 올린 파일에 이름표를 달고, 메모리에 없으면 Gemini 에서 이름표로 찾아
 *   다시 쓴다. 서버가 꺼질 때 지우지 않는다 — 새 서버가 이어서 쓴다. 대신 아무도 기억하지 않는 이름표 파일은
 *   {@code orphanAfter} 가 지나면 주기적으로 지운다. 10/20 운영에서 배포 직후 답이 영상을 다시 올리다 38초 뒤 실패했다.</li>
 * </ul>
 * <p>올리기 끝 준비({@link #warmSource}, 10/21): 영상 올리기가 끝난 순간 같은 준비를 시작한다. 아직 회차가 없어 원본 지문으로
 * 기억하고, 첫 질문이 같은 원본이면 가져간다. 운영 10/17~10/20 첫 질문은 서버에서 18~21초였고, 그중 약 10초가 영상 준비 대기였다.
 * 코칭을 하지 않는 영상도 올라가므로, {@link #SOURCE_WARM_IDLE} 안에 아무도 가져가지 않으면 지운다.
 * {@code scope} 가 없으면(옛 생성자) 이름표 없이 예전처럼 서버가 꺼질 때 다 지운다.
 */
public final class CoachVideoCache implements AutoCloseable {
    /** 기억하지 않는다 — 예전 동작. */
    public static final CoachVideoCache NONE = new CoachVideoCache(null, Duration.ZERO, Clock.systemUTC(), null);
    /** 첫 질문이 미리 준비를 기다리는 최대 시간. 처리 대기 한도(180초)보다 짧다 — 넘으면 직접 올린다. */
    public static final Duration WARM_WAIT = Duration.ofSeconds(150);
    /** 이름표 앞머리. 뒤에 배포 환경·회차·원본 지문이 붙는다. */
    static final String LABEL_PREFIX = "acttub-coach:";
    /** 올리기 끝에서 준비한 파일의 이름표에 회차 대신 붙는 말. 회차 번호(UUID)와 겹치지 않는다. */
    static final String UPLOAD = "upload";
    /**
     * 올리기 끝 준비를 아무 회차도 가져가지 않으면 버리는 시간. 올리고 '질문 받기'까지는 보통 1분이 안 된다.
     * 늦게 눌렀으면 분석 작업이 다시 준비한다.
     */
    static final Duration SOURCE_WARM_IDLE = Duration.ofMinutes(10);

    /** 같은 연습 회차의 같은 원본이어야 다시 쓴다. etag 는 따옴표를 떼고 견준다(저장소마다 붙이는 방식이 다르다). */
    public record Key(UUID practiceId, String objectKey, String etag) {
        public Key {
            etag = etag == null ? null : etag.replace("\"", "");
        }
    }

    /**
     * 얼굴 가리기 회차가 쓰는 원본 자리. 그 회차는 원본이 아니라 얼굴을 가린 사본을 올리므로, 올리기 끝에서 원본으로 시작한
     * 준비({@link #warmSource})나 원본으로 붙인 이름표와 섞이지 않게 다른 키를 쓴다.
     */
    public static String faceMosaicSource(String objectKey) {
        return objectKey == null ? null : objectKey + "#face-mosaic";
    }

    /** 미리 준비한 결과. 소리 검사에서 막혔으면 {@code video} 가 없다. */
    public record Prepared(DirectVideoModel.InputInspection inspection, DirectVideoModel.Video video) { }

    private record Entry(Key key, DirectVideoModel.Video video, Instant lastUsed) { }
    private record Warm(Key key, CompletableFuture<Prepared> result, Instant started) { }

    private final DirectVideoModel model;
    private final Duration idle;
    private final Clock clock;
    private final FailureReporter failures;
    private final String scope;
    private final Duration orphanAfter;
    private final Map<UUID, Entry> entries = new ConcurrentHashMap<>();
    private final Map<UUID, Warm> warming = new ConcurrentHashMap<>();
    /** 올리기 끝 준비. 회차가 아직 없어 원본 지문으로 기억한다. */
    private final Map<String, Warm> sourceWarming = new ConcurrentHashMap<>();
    private final ScheduledExecutorService sweeper;
    /** 미리 준비·원격 지우기를 돌리는 곳. 요청 스레드를 막지 않게 가상 스레드를 쓴다. */
    private final ExecutorService background = Executors.newVirtualThreadPerTaskExecutor();

    public CoachVideoCache(DirectVideoModel model, Duration idle, Clock clock, FailureReporter failures) {
        this(model, idle, clock, failures, null, Duration.ZERO);
    }

    /**
     * @param scope 배포 환경 이름(예: prod·dev). 있으면 이름표를 달아 배포 뒤에도 다시 쓴다. 비어 있으면 예전 동작이다.
     * @param orphanAfter 아무도 기억하지 않는 이름표 파일을 올린 뒤 이만큼 지나면 지운다.
     */
    public CoachVideoCache(DirectVideoModel model, Duration idle, Clock clock, FailureReporter failures,
            String scope, Duration orphanAfter) {
        this.model = model;
        this.idle = idle == null || idle.isNegative() ? Duration.ZERO : idle;
        this.clock = clock == null ? Clock.systemUTC() : clock;
        this.failures = failures;
        this.scope = scope == null || scope.isBlank() ? null : scope.strip().replace(":", "-");
        this.orphanAfter = orphanAfter == null || orphanAfter.isNegative() ? Duration.ZERO : orphanAfter;
        if (enabled()) {
            sweeper = Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "coach-video-cache-sweeper");
                thread.setDaemon(true);
                return thread;
            });
            long every = Math.max(1, Math.min(60, this.idle.toSeconds()));
            sweeper.scheduleWithFixedDelay(this::sweep, every, every, TimeUnit.SECONDS);
            if (labeled() && !this.orphanAfter.isZero()) {
                long orphans = Math.max(60, Math.min(600, this.orphanAfter.toSeconds() / 6));
                sweeper.scheduleWithFixedDelay(this::sweepOrphans, orphans, orphans, TimeUnit.SECONDS);
            }
        } else {
            sweeper = null;
        }
    }

    public boolean enabled() {
        return model != null && !idle.isZero();
    }

    /** 이름표를 달아 배포 뒤에도 다시 쓰는지. */
    boolean labeled() {
        return enabled() && scope != null;
    }

    /** 이 회차·원본으로 올릴 파일의 이름표. 이름표를 쓰지 않으면 null 이다. 원본 키는 지문으로만 남긴다. */
    public String label(Key key) {
        if (!labeled() || key == null || key.practiceId() == null) return null;
        return practicePrefix(key.practiceId()) + fingerprint(key.objectKey() + "|" + key.etag());
    }

    /** 올리기 끝에서 준비할 파일의 이름표. 회차가 없어 원본 지문만 붙는다. 이름표를 쓰지 않으면 null 이다. */
    public String sourceLabel(String objectKey, String etag) {
        if (!labeled() || objectKey == null) return null;
        return LABEL_PREFIX + scope + ":" + UPLOAD + ":" + sourceId(new Key(null, objectKey, etag));
    }

    /** 같은 회차·같은 원본으로 올려 둔 영상이 있으면 돌려준다. 원본이 바뀌었거나 오래됐으면 옛 영상을 지우고 null. */
    public DirectVideoModel.Video take(Key key) {
        if (!enabled() || key == null) return null;
        Entry entry = entries.get(key.practiceId());
        if (entry == null) return remote(key);
        if (!entry.key().equals(key) || expired(entry)) {
            if (entries.remove(key.practiceId(), entry)) delete(entry.video());
            return null;
        }
        entries.replace(key.practiceId(), entry, new Entry(key, entry.video(), clock.instant()));
        return entry.video();
    }

    /** 대화가 이어진다 — 다음 답에서 다시 쓰도록 기억한다. 같은 회차의 다른 영상이 있었으면 그 영상은 지운다. */
    public void keep(Key key, DirectVideoModel.Video video) {
        if (!enabled() || key == null || video == null) return;
        Entry previous = entries.put(key.practiceId(), new Entry(key, video, clock.instant()));
        if (previous != null && !same(previous.video(), video)) delete(previous.video());
    }

    /** 대화가 닫혔거나 답이 실패했다. 기억한 영상을 지우고, 지운 영상을 돌려준다(없으면 null). */
    public DirectVideoModel.Video forget(UUID practiceId) {
        if (practiceId == null) return null;
        Warm warm = warming.remove(practiceId);
        if (warm != null) discard(warm);
        Entry entry = entries.remove(practiceId);
        if (entry == null) {
            // 다른 서버(배포 전)가 올린 이름표 파일일 수 있다. 닫는 답을 늦추지 않게 뒤에서 찾아 지운다.
            if (labeled()) background.execute(() -> deleteRemote(practicePrefix(practiceId), null));
            return null;
        }
        delete(entry.video());
        return entry.video();
    }

    /**
     * 첫 질문용 영상 준비를 뒤에서 시작한다(SOMA-780). {@code work} 는 소리 검사·올리기·처리 대기를 하고 결과를 돌려준다.
     * 같은 회차의 준비가 이미 있으면 옛 것을 버린다(분석 작업이 다시 돈 경우).
     */
    public boolean warm(Key key, Supplier<Prepared> work) {
        if (!enabled() || key == null || key.practiceId() == null || work == null) return false;
        var result = new CompletableFuture<Prepared>();
        Warm warm = new Warm(key, result, clock.instant());
        Warm previous = warming.put(key.practiceId(), warm);
        if (previous != null) discard(previous);
        start(result, work, "CoachVideoCache.warm");
        return true;
    }

    /**
     * 올리기가 끝난 원본의 준비를 뒤에서 시작한다. 회차가 아직 없어 원본(저장소 키·etag)으로 기억하고, 첫 질문의
     * {@link #claimWarm} 이 같은 원본이면 가져간다. 같은 원본의 준비가 이미 있으면 다시 하지 않는다.
     */
    public boolean warmSource(String objectKey, String etag, Supplier<Prepared> work) {
        if (!enabled() || objectKey == null || objectKey.isBlank() || work == null) return false;
        Key key = new Key(null, objectKey, etag);
        var result = new CompletableFuture<Prepared>();
        if (sourceWarming.putIfAbsent(sourceId(key), new Warm(key, result, clock.instant())) != null) return false;
        start(result, work, "CoachVideoCache.warmSource");
        return true;
    }

    /**
     * 올리기 끝에서 시작한 원본 준비를 버린다. 올린 영상은 지금 또는 끝나는 대로 지운다. 얼굴 가리기 회차는 원본을 코치에 쓰지
     * 않는다 — 올리기가 끝날 때는 아직 회차가 없어 얼굴 가리기를 켰는지 모른다.
     */
    public void discardSource(String objectKey, String etag) {
        if (!enabled() || objectKey == null || objectKey.isBlank()) return;
        Warm warm = sourceWarming.remove(sourceId(new Key(null, objectKey, etag)));
        if (warm != null) discard(warm);
    }

    /**
     * 이 회차의 원본을 올리기 끝에서 이미 준비하고 있는지. 분석 작업은 그러면 다시 올리지 않는다.
     * 그 준비가 이미 실패했으면 버리고 false — 분석 작업이 다시 한다.
     */
    public boolean warmingSource(Key key) {
        if (!enabled() || key == null || key.objectKey() == null) return false;
        String id = sourceId(key);
        Warm warm = sourceWarming.get(id);
        if (warm == null) return false;
        if (warm.result().isDone() && warm.result().getNow(null) == null) {
            sourceWarming.remove(id, warm);
            return false;
        }
        return true;
    }

    private void start(CompletableFuture<Prepared> result, Supplier<Prepared> work, String where) {
        background.execute(() -> {
            Prepared prepared = null;
            try {
                prepared = work.get();
            } catch (RuntimeException failure) {
                if (failures != null) failures.report(failure, FailureKind.EXTERNAL, new FailureContext(where));
            }
            result.complete(prepared);
        });
    }

    /**
     * 첫 질문: 미리 준비한 결과를 가져간다. 아직 하는 중이면 {@code wait} 까지 기다린다. 준비가 없거나, 원본이 다르거나,
     * 실패했거나, 너무 오래 걸리면 null — 그때는 지금처럼 직접 올린다.
     */
    public Prepared claimWarm(Key key, Duration wait) {
        if (!enabled() || key == null) return null;
        Warm warm = key.practiceId() == null ? null : warming.remove(key.practiceId());
        if (warm != null && !warm.key().equals(key)) {
            discard(warm);
            warm = null;
        }
        // 회차 준비가 없으면 올리기 끝에서 시작한 같은 원본의 준비를 가져간다.
        if (warm == null && key.objectKey() != null) warm = sourceWarming.remove(sourceId(key));
        if (warm == null) return null;
        if (!sameSource(warm.key(), key)) {
            discard(warm);
            return null;
        }
        try {
            return warm.result().get(wait == null || wait.isNegative() ? 0 : wait.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException | ExecutionException | InterruptedException notReady) {
            if (notReady instanceof InterruptedException) Thread.currentThread().interrupt();
            discard(warm);
            return null;
        }
    }

    static boolean same(DirectVideoModel.Video a, DirectVideoModel.Video b) {
        return a != null && b != null && a.name() != null && a.name().equals(b.name());
    }

    int size() {
        return entries.size();
    }

    int warmingSize() {
        return warming.size();
    }

    int sourceWarmingSize() {
        return sourceWarming.size();
    }

    void sweep() {
        for (Entry entry : entries.values()) {
            if (expired(entry) && entries.remove(entry.key().practiceId(), entry)) delete(entry.video());
        }
        // 첫 질문이 끝내 오지 않은 준비(배우가 분석 중에 나감)는 idle 이 지나면 버린다.
        for (Warm warm : warming.values()) {
            if (!warm.started().plus(idle).isAfter(clock.instant()) && warming.remove(warm.key().practiceId(), warm)) {
                discard(warm);
            }
        }
        // 올리기만 하고 코칭을 시작하지 않은 영상은 더 짧게 둔다.
        Duration sourceIdle = idle.compareTo(SOURCE_WARM_IDLE) < 0 ? idle : SOURCE_WARM_IDLE;
        for (Map.Entry<String, Warm> source : sourceWarming.entrySet()) {
            Warm warm = source.getValue();
            if (!warm.started().plus(sourceIdle).isAfter(clock.instant()) && sourceWarming.remove(source.getKey(), warm)) {
                discard(warm);
            }
        }
    }

    /** 아무도 기억하지 않는 이름표 파일을 지운다. 올린 지 {@code orphanAfter} 가 지난 것만 본다. */
    void sweepOrphans() {
        if (!labeled() || orphanAfter.isZero()) return;
        deleteRemote(LABEL_PREFIX + scope + ":", clock.instant().minus(orphanAfter));
    }

    /** 메모리에 없을 때: 다른 서버가 같은 회차·원본으로 올려 둔 파일을 이름표로 찾는다. */
    private DirectVideoModel.Video remote(Key key) {
        String label = label(key);
        if (label == null) return null;
        // 올리기 끝에서 준비한 파일은 회차 없이 원본 지문만 붙는다. 목록은 한 번만 받는다(목록을 다 받아 걸러내는 방식이다).
        String upload = sourceLabel(key.objectKey(), key.etag());
        try {
            List<DirectVideoModel.Labeled> found = model.labeled(LABEL_PREFIX + scope + ":");
            DirectVideoModel.Labeled newest = found.stream()
                    .filter(file -> label.equals(file.label()) || upload.equals(file.label()))
                    .max(Comparator.comparing(file -> file.created() == null ? Instant.EPOCH : file.created()))
                    .orElse(null);
            if (newest == null) return null;
            entries.put(key.practiceId(), new Entry(key, newest.video(), clock.instant()));
            return newest.video();
        } catch (RuntimeException failure) {
            if (failures != null) {
                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("CoachVideoCache.remote"));
            }
            return null;
        }
    }

    /** 이 접두어의 이름표 파일 중 지금 기억하지 않는 것을 지운다. {@code before} 가 있으면 그보다 먼저 올린 것만. */
    private void deleteRemote(String prefix, Instant before) {
        try {
            for (DirectVideoModel.Labeled file : model.labeled(prefix)) {
                if (before != null && (file.created() == null || !file.created().isBefore(before))) continue;
                if (held(file.video())) continue;
                delete(file.video());
            }
        } catch (RuntimeException failure) {
            if (failures != null) {
                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("CoachVideoCache.deleteRemote"));
            }
        }
    }

    private boolean held(DirectVideoModel.Video video) {
        for (Entry entry : entries.values()) if (same(entry.video(), video)) return true;
        for (Warm warm : warming.values()) {
            Prepared prepared = warm.result().getNow(null);
            if (prepared != null && same(prepared.video(), video)) return true;
        }
        for (Warm warm : sourceWarming.values()) {
            Prepared prepared = warm.result().getNow(null);
            if (prepared != null && same(prepared.video(), video)) return true;
        }
        return false;
    }

    /** 원본 지문. 회차와 상관없이 같은 저장소 키·etag 면 같다. */
    private static String sourceId(Key key) {
        return fingerprint(key.objectKey() + "|" + key.etag());
    }

    private static boolean sameSource(Key a, Key b) {
        return java.util.Objects.equals(a.objectKey(), b.objectKey()) && java.util.Objects.equals(a.etag(), b.etag());
    }

    /** 버린 준비: 올린 영상이 있으면(지금 또는 끝나는 대로) 지운다. */
    private void discard(Warm warm) {
        warm.result().thenAccept(prepared -> {
            if (prepared != null && prepared.video() != null) delete(prepared.video());
        });
    }

    private String practicePrefix(UUID practiceId) {
        return LABEL_PREFIX + scope + ":" + practiceId + ":";
    }

    /** 원본 키·etag 의 짧은 지문. 보안용이 아니라 같은 원본인지 가리는 이름표다. */
    private static String fingerprint(String source) {
        return UUID.nameUUIDFromBytes(source.getBytes(StandardCharsets.UTF_8)).toString().replace("-", "").substring(0, 16);
    }

    private boolean expired(Entry entry) {
        return !entry.lastUsed().plus(idle).isAfter(clock.instant());
    }

    private void delete(DirectVideoModel.Video video) {
        try {
            model.delete(video);
        } catch (RuntimeException failure) {
            if (failures != null) {
                failures.report(failure, FailureKind.EXTERNAL, new FailureContext("CoachVideoCache.delete"));
            }
        }
    }

    /**
     * 서버가 꺼진다. 이름표를 쓰면 지우지 않는다 — 새 서버가 이름표로 찾아 이어 쓰고, 버려진 것은 고아 청소가 지운다.
     * 이름표가 없으면 예전처럼 기억한 영상을 다 지운다.
     */
    @Override
    public void close() {
        if (sweeper != null) sweeper.shutdownNow();
        if (!labeled()) {
            for (UUID practiceId : entries.keySet()) forget(practiceId);
            for (UUID practiceId : warming.keySet()) {
                Warm warm = warming.remove(practiceId);
                if (warm != null) discard(warm);
            }
            for (String source : sourceWarming.keySet()) {
                Warm warm = sourceWarming.remove(source);
                if (warm != null) discard(warm);
            }
        }
        background.shutdown();
    }
}
