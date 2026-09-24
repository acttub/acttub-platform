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

/** Gemini transport for the existing durable coach API; no layer-one model or route classifier. Practice loop by deployment. */
public final class DirectVideoCoach {
    private final DirectVideoModel model;
    private final CoachVideoSource videos;
    private final ObjectStorage storage;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;
    // 연습 루프 프롬프트 하나로 대화 전체를 끌고 간다. 배포가 정한다(기본 켜짐).
    private final boolean practiceLoop;

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry) {
        this(model, videos, storage, failures, telemetry, false);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop) {
        this.practiceLoop = practiceLoop;
        this.model = model;
        this.videos = videos;
        this.storage = storage;
        this.failures = failures;
        this.telemetry = telemetry;
    }

    public boolean practiceLoop() {
        return practiceLoop;
    }

    public CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId) {
        Path local = null;
        DirectVideoModel.Video uploaded = null;
        Instant started = Instant.now();
        // 루프 이전에 열린 세션은 기존 프롬프트로 이어간다.
        boolean loop = practiceLoop && DirectVideoPracticeLoop.applies(session);
        var history = new ArrayList<DirectVideoModel.Message>();
        if (loop) {
            history.addAll(DirectVideoPracticeLoop.history(session.turns(), session.coachingState(), actorText));
        } else {
            session.turns().forEach(turn -> history.add(new DirectVideoModel.Message(
                    "ai".equals(turn.role()) ? "model" : "user", turn.text())));
            if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        }
        String prompt = loop ? DirectVideoPrompts.practiceLoop() : DirectVideoPrompts.common();
        String input = prompt + "\n" + history;
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
            ExternalOperationExecution.externalCall("model");
            String message = model.reply(uploaded, history, prompt);
            if (message == null || message.isBlank()) throw new IllegalStateException("empty video coaching reply");
            var parsed = loop ? DirectVideoPracticeLoop.parse(message) : null;
            // 배우에게는 코치 본문만 저장한다. 숨은 칸(<설계>·<상태>)은 아래에서 상태에 둔다.
            String shown = loop ? parsed.message() : message.strip();
            if (shown.isBlank()) throw new IllegalStateException("empty video coaching reply");
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, message, LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    null, LlmCall.metadata("transport", "gemini_direct_video", "route", loop ? "practice_loop" : "common")));
            ObjectNode state = session.coachingState() == null ? CoachingStateReducer.empty()
                    : ((ObjectNode) session.coachingState()).deepCopy();
            CoachingStateReducer.require(state.path("revision").asLong() == session.stateRevision(), "stored revision mismatch");
            state.put("revision", session.stateRevision() + 1);
            if (loop) DirectVideoPracticeLoop.remember(state, parsed);
            // Plain coaching prose is not structured evidence or a confirmed actor intention.
            boolean actorFinished = DialogueProgress.actorFinished(actorText);
            boolean turnBudget = session.turns().stream().filter(t -> "ai".equals(t.role())).count() >= 9;
            return StructuredCoachEngine.result(session, actorText, shown, state,
                    actorFinished ? "actor_finished" : turnBudget ? "turn_budget"
                            : loop && DirectVideoPracticeLoop.finished(parsed) ? "interrupted" : null);
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.turn", operationId));
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("transport", "gemini_direct_video")));
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
