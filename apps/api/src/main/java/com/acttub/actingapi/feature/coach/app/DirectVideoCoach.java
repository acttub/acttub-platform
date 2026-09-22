package com.acttub.actingapi.feature.coach.app;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Gemini transport for the existing durable coach API; no layer-one model; response routing is a separate text call. */
public final class DirectVideoCoach {
    private final DirectVideoModel model;
    private final CoachVideoSource videos;
    private final ObjectStorage storage;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;
    private final DirectVideoRouting routing;

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry) {
        this.model = model;
        this.videos = videos;
        this.storage = storage;
        this.failures = failures;
        this.telemetry = telemetry;
        this.routing = new DirectVideoRouting(model, failures, telemetry::record);
    }

    public CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId) {
        Path local = null;
        DirectVideoModel.Video uploaded = null;
        Instant started = Instant.now();
        var history = new ArrayList<DirectVideoModel.Message>();
        session.turns().forEach(turn -> history.add(new DirectVideoModel.Message(
                "ai".equals(turn.role()) ? "model" : "user", turn.text())));
        if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        String input = "";
        String route = "";
        boolean routeFallback = false;
        boolean actorFinished = DialogueProgress.actorFinished(actorText);
        boolean turnBudget = session.turns().stream().filter(t -> "ai".equals(t.role())).count() >= 9;
        try {
            var source = videos.find(session.userId(), session.practiceSessionId());
            if (source == null) throw new IllegalStateException("owned video is unavailable");
            local = Files.createTempFile("coach-original-", ".video");
            var metadata = storage.downloadToPath(source.objectKey(), local);
            if (source.etag() != null && !source.etag().isBlank()
                    && !source.etag().replace("\"", "").equals(metadata.etag().replace("\"", ""))) {
                throw new IllegalStateException("original video changed after upload");
            }
            ExternalOperationExecution.externalCall("video_upload");
            uploaded = model.upload(local, source.mimeType());
            long deadline = System.nanoTime() + Duration.ofSeconds(180).toNanos();
            while (!model.ready(uploaded)) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                Thread.sleep(1000);
            }
            var selection = routing.select(history, actorText, actorFinished || turnBudget,
                    session.practiceSessionId(), session.userId(), operationId);
            route = selection.label();
            routeFallback = selection.fallback();
            String prompt = selection.prompt();
            input = prompt + "\n" + history;
            ExternalOperationExecution.externalCall("model");
            String message = model.reply(uploaded, history, prompt);
            if (message == null || message.isBlank()) throw new IllegalStateException("empty video coaching reply");
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, message, LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    null, LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(routeFallback))));
            ObjectNode state = session.coachingState() == null ? CoachingStateReducer.empty()
                    : ((ObjectNode) session.coachingState()).deepCopy();
            CoachingStateReducer.require(state.path("revision").asLong() == session.stateRevision(), "stored revision mismatch");
            state.put("revision", session.stateRevision() + 1);
            // Plain coaching prose is not structured evidence or a confirmed actor intention.
            return StructuredCoachEngine.result(session, actorText, message.strip(), state,
                    actorFinished ? "actor_finished" : turnBudget ? "turn_budget" : null);
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.turn", operationId));
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(routeFallback))));
            throw new CoachReplyUnavailable();
        } finally {
            if (uploaded != null) {
                try { model.delete(uploaded); }
                catch (RuntimeException failure) {
                    failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.delete", operationId));
                }
            }
            if (local != null) {
                try { Files.deleteIfExists(local); }
                catch (java.io.IOException failure) {
                    failures.report(failure, new FailureContext("DirectVideoCoach.tempCleanup", operationId));
                }
            }
        }
    }
}
