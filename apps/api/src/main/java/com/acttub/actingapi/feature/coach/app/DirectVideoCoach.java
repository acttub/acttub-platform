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
import com.acttub.actingapi.platform.observability.LlmPrompt;
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
    // 연습 루프 프롬프트 하나로 대화 전체를 끌고 간다(분류·과제 조립을 건너뛴다). 배포가 정한다.
    private final boolean practiceLoop;

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop) {
        this.practiceLoop = practiceLoop;
        this.model = model;
        this.videos = videos;
        this.storage = storage;
        this.failures = failures;
        this.telemetry = telemetry;
        this.routing = new DirectVideoRouting(model, failures, telemetry::record);
    }

    public boolean practiceLoop() {
        return practiceLoop;
    }

    public CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId) {
        Path local = null;
        DirectVideoModel.Video uploaded = null;
        Instant started = Instant.now();
        boolean loop = practiceLoop && DirectVideoPracticeLoop.applies(session);
        var history = new ArrayList<DirectVideoModel.Message>();
        if (loop) {
            history.addAll(DirectVideoPracticeLoop.history(session.turns(), session.coachingState(), actorText));
        } else {
            session.turns().forEach(turn -> history.add(new DirectVideoModel.Message(
                    "ai".equals(turn.role()) ? "model" : "user", turn.text())));
            if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        }
        String input = "";
        String route = "";
        // 기록에 잇는 것은 고른 과제 템플릿뿐이다. 앞에 붙는 배우 프로필·이전 맥락은 요청마다 달라 넣지 않는다.
        LlmPrompt template = null;
        boolean routeFallback = false;
        boolean inspecting = false;
        boolean actorFinished = DialogueProgress.actorFinished(actorText);
        // ConversationService.THREE_LAYERS_REPLY_LIMIT 을 따른다 — 이번 응답이 그 상한을 채우면 강제 종료한다.
        boolean turnBudget = session.turns().stream().filter(t -> "ai".equals(t.role())).count()
                >= ConversationService.THREE_LAYERS_REPLY_LIMIT - 1;
        if (loop && DirectVideoPracticeLoop.tooShort(session)) {
            // 연기가 담길 수 없는 길이 — 영상을 올리거나 모델을 부르지 않고 끊는다. 노트도 만들지 않는다.
            ObjectNode cutState = nextState(session);
            DirectVideoPracticeLoop.markNotActing(cutState, "too_short");
            return StructuredCoachEngine.result(session, actorText,
                    DirectVideoPracticeLoop.notActingMessage(DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                    cutState, "interrupted");
        }
        try {
            var source = videos.find(session.userId(), session.practiceSessionId());
            if (source == null) throw new IllegalStateException("owned video is unavailable");
            local = Files.createTempFile("coach-original-", ".video");
            var metadata = storage.downloadToPath(source.objectKey(), local);
            if (source.etag() != null && !source.etag().isBlank()
                    && !source.etag().replace("\"", "").equals(metadata.etag().replace("\"", ""))) {
                throw new IllegalStateException("original video changed after upload");
            }
            DirectVideoModel.InputInspection inspection = null;
            if (loop && session.turns().isEmpty()) {
                inspecting = true;
                inspection = model.inspect(local);
                inspecting = false;
                if (inspection != null && inspection.unusableAudio()) {
                    ObjectNode cutState = nextState(session);
                    DirectVideoPracticeLoop.markInputIssue(cutState, "silent_audio");
                    return StructuredCoachEngine.result(session, actorText,
                            DirectVideoPracticeLoop.audioUnavailableMessage(
                                    DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                            cutState, "interrupted");
                }
                if (inspection != null && inspection.emptyInput()) {
                    ObjectNode cutState = nextState(session);
                    DirectVideoPracticeLoop.markNotActing(cutState, "empty_input");
                    return StructuredCoachEngine.result(session, actorText,
                            DirectVideoPracticeLoop.notActingMessage(
                                    DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                            cutState, "interrupted");
                }
            }
            ExternalOperationExecution.externalCall("video_upload");
            uploaded = inspection == null || inspection.hasAudioTrack() == null
                    ? model.upload(local, source.mimeType()) : model.upload(local, source.mimeType(), inspection);
            long deadline = System.nanoTime() + Duration.ofSeconds(180).toNanos();
            while (!model.ready(uploaded)) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                Thread.sleep(1000);
            }
            String written = DirectVideoPracticeLoop.actorMaterial(session) + "\n"
                    + session.turns().stream().filter(turn -> !"ai".equals(turn.role()))
                            .map(turn -> turn.text()).collect(java.util.stream.Collectors.joining("\n"))
                    + "\n" + (actorText == null ? "" : actorText);
            ObjectNode state = nextState(session);
            if (loop) {
                DirectVideoDialogueEvidence.discardUngroundedDesign(uploaded, state, written);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText));
            }
            String task;
            if (loop) {
                // 종료("그만")도 연습 루프가 해 본 횟수로 닫는다. 서버는 아래에서 세션만 닫는다.
                route = "practice_loop";
                java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
                task = DirectVideoPrompts.practiceLoop(session.practiceSessionId(), language);
                // 기록에는 칸 순서를 섞기 전 템플릿을 잇는다. 섞인 본문마다 Langfuse 버전이 새로 생기지 않게 한다.
                boolean korean = language == null || "ko".equals(language.getLanguage());
                template = korean ? new LlmPrompt("coach.practice-loop", DirectVideoPrompts.practiceLoop())
                        : new LlmPrompt("coach.practice-loop.en", DirectVideoPrompts.practiceLoopEnglish());
            } else {
                var selection = routing.select(history, actorText, actorFinished || turnBudget,
                        session.practiceSessionId(), session.userId(), operationId);
                route = selection.label();
                routeFallback = selection.fallback();
                task = selection.prompt();
                template = new LlmPrompt("coach.direct." + route, task);
            }
            // 연습 루프는 배우가 이번 연습에 적은 것(상황·인물·목표·막힘)도 받는다. 없으면 칸이 없다.
            String prompt = DirectVideoPrompts.withAudioFacts(CoachPrompt.actorProfileBlock(session.actorProfile())
                    + CoachPrompt.priorContextBlock(session.priorForModel(), true, loop)
                    + (loop ? DirectVideoPracticeLoop.actorMaterial(session) : "") + task, uploaded);
            input = CoachPrompt.withoutActorName(prompt, session.actorProfile()) + "\n" + history;
            ExternalOperationExecution.externalCall("model");
            String message = model.reply(uploaded, history, prompt);
            if (message == null || message.isBlank()) throw new IllegalStateException("empty video coaching reply");
            DirectVideoDialogueEvidence.requireGrounded(uploaded, message, written);
            var parsed = loop ? DirectVideoPracticeLoop.parse(message) : null;
            // 배우에게는 코치 본문만 저장한다. 숨은 칸(<설계>·<상태>)은 아래에서 상태에 둔다.
            String shown = loop ? parsed.message() : message.strip();
            // 첫 응답에서 모델이 연기 영상이 아니라고 분류했으면 그 코치 문장은 버리고 끊는다.
            boolean cut = loop && session.turns().isEmpty() && DirectVideoPracticeLoop.notActing(parsed);
            if (cut) shown = DirectVideoPracticeLoop.notActingMessage(DirectVideoPracticeLoop.replyLanguage(session, actorText));
            if (shown.isBlank()) throw new IllegalStateException("empty video coaching reply");
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, message, LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    null, LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(routeFallback))).withPrompt(template));
            if (loop) DirectVideoPracticeLoop.remember(state, parsed);
            if (cut) DirectVideoPracticeLoop.markNotActing(state, "model");
            // Plain coaching prose is not structured evidence or a confirmed actor intention.
            return StructuredCoachEngine.result(session, actorText, shown, state,
                    actorFinished ? "actor_finished" : turnBudget ? "turn_budget"
                            : cut || loop && DirectVideoPracticeLoop.finished(parsed) ? "interrupted" : null);
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            failures.report(failure, inspecting ? FailureKind.UNEXPECTED : FailureKind.EXTERNAL,
                    new FailureContext(inspecting ? "DirectVideoCoach.inspect" : "DirectVideoCoach.turn", operationId));
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(routeFallback))).withPrompt(template));
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

    /** 저장된 상태를 복사해 다음 판으로 올린다. 저장 판이 어긋나면 실패한다. */
    private static ObjectNode nextState(CoachSessionSnapshot session) {
        ObjectNode state = session.coachingState() == null ? CoachingStateReducer.empty()
                : ((ObjectNode) session.coachingState()).deepCopy();
        CoachingStateReducer.require(state.path("revision").asLong() == session.stateRevision(), "stored revision mismatch");
        state.put("revision", session.stateRevision() + 1);
        return state;
    }
}
