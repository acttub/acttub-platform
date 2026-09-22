package com.acttub.actingapi.feature.coach.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.DirectVideoModel.Message;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.scheduling.annotation.Scheduled;

/** Disposable dev experiment. No practice session, layer 1 worker or persistent report is created. */
public final class DirectVideoSessions implements AutoCloseable {
    private static final Duration TTL = Duration.ofMinutes(30);
    private final Map<UUID, Session> sessions = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newVirtualThreadPerTaskExecutor();
    private final DirectVideoModel model;
    private final FailureReporter failures;
    private final Clock clock;
    private final DirectVideoRouting routing;

    public DirectVideoSessions(DirectVideoModel model, FailureReporter failures, Clock clock) {
        this.model = model;
        this.failures = failures;
        this.clock = clock;
        this.routing = new DirectVideoRouting(model, failures, call -> {});
    }

    public record View(UUID id, String status, String model, List<Message> messages, String error, Instant expiresAt) {}

    /** Takes ownership of the temporary upload only on success. */
    public synchronized View start(UUID owner, Path path, String mimeType) {
        if (sessions.size() >= 12 || sessions.values().stream().filter(s -> s.owner.equals(owner)).count() >= 2) {
            throw new ApiException(429, "direct_video_session_limit");
        }
        Session session = new Session(owner, clock.instant().plus(TTL));
        sessions.put(session.id, session);
        worker.submit(() -> {
            try {
                session.video = model.upload(path, mimeType);
                Instant deadline = clock.instant().plusSeconds(180);
                while (!model.ready(session.video)) {
                    if (session.closed || clock.instant().isAfter(deadline)) throw new IllegalStateException("video processing timeout");
                    Thread.sleep(2000);
                }
                generate(session, null);
            } catch (Exception failure) {
                failed(session, failure);
            } finally {
                try { Files.deleteIfExists(path); }
                catch (IOException failure) { failures.report(failure, new FailureContext("DirectVideoSessions.localCleanup")); }
                if (session.closed) deleteVideo(session);
            }
        });
        return view(session);
    }

    public View get(UUID owner, UUID id) { return view(owned(owner, id)); }

    public View send(UUID owner, UUID id, String text) {
        Session session = owned(owner, id);
        synchronized (session) {
            if (session.messages.size() >= 19) throw new ApiException(409, "direct_video_turn_limit");
            if (!"ready".equals(session.status)) throw new ApiException(409, "direct_video_not_ready");
            session.status = "replying";
            session.error = null;
        }
        worker.submit(() -> {
            try { generate(session, text); }
            catch (Exception failure) { failed(session, failure); }
            finally { if (session.closed) deleteVideo(session); }
        });
        return view(session);
    }

    public void delete(UUID owner, UUID id) {
        Session session = owned(owner, id);
        discard(session);
    }

    private void generate(Session session, String text) {
        List<Message> history;
        synchronized (session) {
            if (session.closed) return;
            history = new ArrayList<>(session.messages);
        }
        boolean finish = DialogueProgress.actorFinished(text) || (text != null && history.size() >= 17);
        if (text != null) history.add(new Message("user", text));
        if (session.closed) return;
        var selection = routing.select(history, text, finish, null, session.owner, session.id);
        String reply = model.reply(session.video, history, selection.prompt());
        if (reply == null || reply.isBlank()) throw new IllegalStateException("empty video coaching reply");
        synchronized (session) {
            if (session.closed) return;
            if (text != null) session.messages.add(new Message("user", text));
            session.messages.add(new Message("model", reply));
            session.status = finish ? "finished" : "ready";
        }
    }

    private void failed(Session session, Exception failure) {
        if (session.closed) return;
        failures.report(failure, new FailureContext("DirectVideoSessions.generate", session.id));
        synchronized (session) {
            session.status = session.messages.isEmpty() ? "failed" : "ready";
            session.error = "direct_video_generation_failed";
        }
        if (session.messages.isEmpty()) deleteVideo(session);
    }

    private Session owned(UUID owner, UUID id) {
        Session session = sessions.get(id);
        if (session == null || !session.owner.equals(owner) || session.closed
                || !clock.instant().isBefore(session.expiresAt)) throw new ApiException(404, "direct_video_not_found");
        return session;
    }

    private View view(Session session) {
        synchronized (session) {
            return new View(session.id, session.status, model.model(), List.copyOf(session.messages), session.error, session.expiresAt);
        }
    }

    @Scheduled(fixedDelay = 60000)
    public void expire() {
        sessions.values().stream().filter(s -> !clock.instant().isBefore(s.expiresAt)).forEach(this::discard);
    }

    private void discard(Session session) {
        session.closed = true;
        sessions.remove(session.id, session);
        worker.submit(() -> deleteVideo(session));
    }

    private void deleteVideo(Session session) {
        synchronized (session) {
            if (session.video == null) return;
            try {
                model.delete(session.video);
                session.video = null;
            } catch (RuntimeException failure) {
                failures.report(failure, new FailureContext("DirectVideoSessions.remoteCleanup", session.id));
            }
        }
    }

    @Override public void close() {
        sessions.values().forEach(this::discard);
        worker.shutdown();
    }

    private static final class Session {
        final UUID id = UUID.randomUUID();
        final UUID owner;
        final Instant expiresAt;
        final List<Message> messages = new ArrayList<>();
        volatile DirectVideoModel.Video video;
        volatile boolean closed;
        String status = "preparing";
        String error;
        Session(UUID owner, Instant expiresAt) { this.owner = owner; this.expiresAt = expiresAt; }
    }
}
