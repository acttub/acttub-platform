package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.acttub.actingapi.integration.observation.LayerOneObserver;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * 코칭 1층 관찰 A/B(SOMA-815). 배정된 연습은 분석 작업이 원본을 내려받는 순간 1층을 뒤에서 시작하고, 코치는 턴마다
 * 끝났는지만 본다 — 기다리지 않는다. 첫 질문 때까지 안 끝나면 그 턴은 지금처럼 가고, 끝난 다음 턴부터 칸이 붙는다.
 *
 * <p>배정은 연습 id 로 정해 같은 연습은 늘 같은 쪽이다. 코치 흐름·모델 배정과 겹치지 않게 다른 해시를 쓴다.
 * share 가 0 이거나 관찰기가 없으면 모두 끔(롤백). 결과는 서버 메모리에 2시간 둔다 — 코치가 받으면 대화 상태에 저장하므로
 * 재시작 뒤에도 이미 받은 대화는 이어진다.
 */
public final class CoachLayerOne implements AutoCloseable {
    public static final String ON = "on";
    public static final String OFF = "off";
    public static final CoachLayerOne NONE = new CoachLayerOne(null, 0, null, Clock.systemUTC());
    static final Duration KEEP = Duration.ofHours(2);

    /** 분석 작업이 넘기는 장면 정보. */
    public record Scene(String situation, String character, String goal) {
        String text() {
            StringBuilder s = new StringBuilder();
            for (String v : new String[] {situation, character, goal}) {
                if (v == null || v.isBlank() || ".".equals(v.strip())) continue;
                if (!s.isEmpty()) s.append(" / ");
                s.append(v.strip());
            }
            return s.toString();
        }
    }

    private record Entry(CompletableFuture<String> result, Instant started) { }

    private final LayerOneObserver observer;
    private final int share;
    private final FailureReporter failures;
    private final Clock clock;
    private final ExecutorService pool;
    private final Map<UUID, Entry> running = new ConcurrentHashMap<>();

    public CoachLayerOne(LayerOneObserver observer, int share, FailureReporter failures) {
        this(observer, share, failures, Clock.systemUTC());
    }

    CoachLayerOne(LayerOneObserver observer, int share, FailureReporter failures, Clock clock) {
        this.observer = observer;
        this.share = observer == null ? 0 : Math.max(0, Math.min(100, share));
        this.failures = failures;
        this.clock = clock;
        this.pool = this.share == 0 ? null : Executors.newFixedThreadPool(2, runnable -> {
            Thread thread = new Thread(runnable, "coach-layer1");
            thread.setDaemon(true);
            return thread;
        });
    }

    /** 이 연습이 1층을 받는 쪽인지. */
    public String arm(UUID practiceId) {
        if (share == 0 || practiceId == null) return OFF;
        long mixed = practiceId.getLeastSignificantBits() * 0x9E3779B97F4A7C15L ^ practiceId.getMostSignificantBits();
        return Math.floorMod(Long.hashCode(mixed >>> 7), 100) < share ? ON : OFF;
    }

    /**
     * 분석 작업이 원본을 내려받았다. 배정된 연습이면 사본을 만들어 뒤에서 1층을 시작한다(호출이 끝나면 원본은 지워진다).
     * 이미 시작했으면 아무것도 하지 않는다.
     */
    public void start(UUID practiceId, UUID userId, Path file, String mimeType, Scene scene) {
        if (!ON.equals(arm(practiceId)) || file == null) return;
        prune();
        if (running.containsKey(practiceId)) return;
        Path copy;
        try {
            copy = Files.createTempFile(file.toAbsolutePath().getParent(), "coach-layer1-", ".video");
            Files.copy(file, copy, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException | RuntimeException failure) {
            report(failure, "copy");
            return;
        }
        String sceneText = scene == null ? "" : scene.text();
        CompletableFuture<String> result = CompletableFuture.supplyAsync(() -> {
            try {
                return observer.observe(copy, mimeType, sceneText, practiceId, userId);
            } finally {
                try {
                    Files.deleteIfExists(copy);
                } catch (IOException ignored) {
                    // 임시 폴더라 남아도 서버가 정리한다.
                }
            }
        }, pool).exceptionally(failure -> {
            report(failure, "observe");
            return "";
        });
        if (running.putIfAbsent(practiceId, new Entry(result, clock.instant())) != null) result.cancel(false);
    }

    /** 끝난 1층 칸. 아직 안 끝났거나 실패·빈 결과면 빈 글이다. 기다리지 않는다. */
    public String ready(UUID practiceId) {
        if (practiceId == null) return "";
        Entry entry = running.get(practiceId);
        if (entry == null || !entry.result().isDone() || entry.result().isCancelled()) return "";
        String block = entry.result().getNow("");
        return block == null ? "" : block;
    }

    /** 1층을 시작했고 아직 안 끝났는지. 기록용이다. */
    public boolean pending(UUID practiceId) {
        Entry entry = practiceId == null ? null : running.get(practiceId);
        return entry != null && !entry.result().isDone();
    }

    private void prune() {
        Instant limit = clock.instant().minus(KEEP);
        running.entrySet().removeIf(e -> e.getValue().started().isBefore(limit));
    }

    private void report(Throwable failure, String where) {
        if (failures == null) return;
        Throwable cause = failure.getCause() != null && failure instanceof java.util.concurrent.CompletionException
                ? failure.getCause() : failure;
        failures.report(cause, FailureKind.EXTERNAL, new FailureContext("CoachLayerOne." + where));
    }

    @Override
    public void close() {
        if (pool != null) pool.shutdownNow();
    }
}
