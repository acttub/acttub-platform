package com.acttub.actingapi.feature.coach.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

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
 * <p>지우는 때: 대화가 닫히거나 답이 실패하면 바로, 마지막으로 쓴 뒤 {@code idle} 동안 다시 쓰지 않으면, 서버가 꺼질 때.
 * 원본(저장소 키·etag)이 바뀌면 옛 영상을 지우고 다시 올린다. 기억은 서버 한 대의 메모리라 배포·재시작 뒤에는 그냥 다시 올린다.
 * {@code idle} 이 0 이면 아무것도 기억하지 않는다 — 예전처럼 답마다 올리고 지운다(롤백).
 */
public final class CoachVideoCache implements AutoCloseable {
    /** 기억하지 않는다 — 예전 동작. */
    public static final CoachVideoCache NONE = new CoachVideoCache(null, Duration.ZERO, Clock.systemUTC(), null);

    /** 같은 연습 회차의 같은 원본이어야 다시 쓴다. */
    public record Key(UUID practiceId, String objectKey, String etag) { }

    private record Entry(Key key, DirectVideoModel.Video video, Instant lastUsed) { }

    private final DirectVideoModel model;
    private final Duration idle;
    private final Clock clock;
    private final FailureReporter failures;
    private final Map<UUID, Entry> entries = new ConcurrentHashMap<>();
    private final ScheduledExecutorService sweeper;

    public CoachVideoCache(DirectVideoModel model, Duration idle, Clock clock, FailureReporter failures) {
        this.model = model;
        this.idle = idle == null || idle.isNegative() ? Duration.ZERO : idle;
        this.clock = clock == null ? Clock.systemUTC() : clock;
        this.failures = failures;
        if (enabled()) {
            sweeper = Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "coach-video-cache-sweeper");
                thread.setDaemon(true);
                return thread;
            });
            long every = Math.max(1, Math.min(60, this.idle.toSeconds()));
            sweeper.scheduleWithFixedDelay(this::sweep, every, every, TimeUnit.SECONDS);
        } else {
            sweeper = null;
        }
    }

    public boolean enabled() {
        return model != null && !idle.isZero();
    }

    /** 같은 회차·같은 원본으로 올려 둔 영상이 있으면 돌려준다. 원본이 바뀌었거나 오래됐으면 옛 영상을 지우고 null. */
    public DirectVideoModel.Video take(Key key) {
        if (!enabled() || key == null) return null;
        Entry entry = entries.get(key.practiceId());
        if (entry == null) return null;
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
        Entry entry = entries.remove(practiceId);
        if (entry == null) return null;
        delete(entry.video());
        return entry.video();
    }

    static boolean same(DirectVideoModel.Video a, DirectVideoModel.Video b) {
        return a != null && b != null && a.name() != null && a.name().equals(b.name());
    }

    int size() {
        return entries.size();
    }

    void sweep() {
        for (Entry entry : entries.values()) {
            if (expired(entry) && entries.remove(entry.key().practiceId(), entry)) delete(entry.video());
        }
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

    @Override
    public void close() {
        if (sweeper != null) sweeper.shutdownNow();
        for (UUID practiceId : entries.keySet()) forget(practiceId);
    }
}
