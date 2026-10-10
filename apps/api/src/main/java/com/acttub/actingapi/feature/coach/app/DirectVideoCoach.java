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
    /** 노트의 다음 촬영에는 행동만 남긴다 — "그 해석이면 ~"의 앞말을 뗀다(dev 시험 10/11). */
    private static final java.util.regex.Pattern READING_LEAD =
            java.util.regex.Pattern.compile("^(?:그|이|말한) ?해석(?:이면|대로라면|대로면|대로)[,]?\\s*");

    private final DirectVideoModel model;
    private final CoachVideoSource videos;
    private final ObjectStorage storage;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;
    private final DirectVideoRouting routing;
    // 연습 루프로 대화를 끌고 간다. 첫 응답은 연습 루프 프롬프트, 둘째 응답부터는 코드가 할 일을 정한다. 배포가 정한다.
    private final boolean practiceLoop;
    // 자문위원 연습만 코치 성격을 번갈아 받는다(SOMA-622). 그 밖의 배우는 늘 기본 성격이다.
    private final CoachPersonas personas;

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop) {
        this(model, videos, storage, failures, telemetry, practiceLoop, CoachPersonas.NONE);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas) {
        this.personas = personas == null ? CoachPersonas.NONE : personas;
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
        String persona = loop ? persona(session, operationId) : "";
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
        // 둘째 응답부터: 배우의 말을 따로 분류하고 할 일·횟수·피할 것을 코드가 정한다(PracticeLoopRouter).
        Branch branch = loop && !session.turns().isEmpty() && actorText != null ? branch(session, actorText, operationId) : null;
        if (branch != null && PracticeLoopRouter.END.equals(branch.doing())) {
            // 그만·자기 한 줄·응답 상한: 코치 AI를 부르지 않고 닫는다. 앱은 바로 노트로 넘어간다.
            String closing = fixedClosing(DirectVideoPracticeLoop.replyLanguage(session, actorText));
            ObjectNode state = nextState(session);
            DirectVideoPracticeLoop.remember(state, new DirectVideoPracticeLoop.Parsed("", branch.status(), closing));
            // 닫힌 사유: 배우가 그만 → user_ended, 응답 상한 → limit, 그 밖(물을 것을 다 물음) → exhausted.
            boolean stopped = actorFinished || branch.classified().kind() == PracticeLoopRouter.Kind.STOP;
            boolean ceiling = turnBudget || branch.before().reply() >= PracticeLoopRouter.LAST_REPLY - 1;
            return StructuredCoachEngine.result(session, actorText, closing, state,
                    stopped ? "actor_finished" : ceiling ? "turn_budget" : "interrupted");
        }
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
            if (!persona.isEmpty()) DirectVideoPracticeLoop.rememberPersona(state, persona);
            if (loop) {
                DirectVideoDialogueEvidence.discardUngroundedDesign(uploaded, state, written);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText));
            }
            String task;
            if (branch != null) {
                route = "practice_loop:" + branch.doing();
                java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText, false));
                String design = state.path(DirectVideoPracticeLoop.STATE_KEY).path("design").asText("");
                task = DirectVideoPrompts.practiceLoopTurn(language) + "\n\n" + branch.instruction(language,
                        DirectVideoPrompts.practiceLoopTask(branch.doing(), language)) + personaBlock(persona, language);
                boolean korean = language == null || "ko".equals(language.getLanguage());
                template = korean ? new LlmPrompt("coach.practice-loop.turn", DirectVideoPrompts.practiceLoopTurn())
                        : new LlmPrompt("coach.practice-loop.turn.en", DirectVideoPrompts.practiceLoopTurnEnglish());
            } else if (loop) {
                // 종료("그만")도 연습 루프가 해 본 횟수로 닫는다. 서버는 아래에서 세션만 닫는다.
                route = "practice_loop";
                java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
                task = DirectVideoPrompts.practiceLoop(session.practiceSessionId(), language) + personaBlock(persona, language);
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
                    + CoachPrompt.priorContextBlock(session.priorForModel(), true, false)
                    + (loop ? DirectVideoPracticeLoop.actorMaterial(session) : "") + task, uploaded);
            input = CoachPrompt.withoutActorName(prompt, session.actorProfile()) + "\n" + history;
            ExternalOperationExecution.externalCall("model");
            String message = replyOrNull(uploaded, history, prompt, loop);
            // 연습 루프에서 배우에게 보일 말이 비었으면(빈 응답, 숨은 메모만 쓴 응답) 한 번 다시 쓰게 한다.
            boolean emptyRetry = false;
            if (loop && (message == null || DirectVideoPracticeLoop.parse(message).message().isBlank())) {
                emptyRetry = true;
                ExternalOperationExecution.externalCall("model");
                message = replyOrNull(uploaded, history, prompt + "\n\n"
                        + DirectVideoPracticeLoop.emptyRetryNote(DirectVideoPracticeLoop.replyLanguage(session, actorText)), loop);
            }
            // 대화와 상관없는 글(웹페이지·코드·자모)이 나오면 배우에게 보내지 않고 한 번 다시 쓰게 한다.
            // 다시 써도 깨졌으면 빈 답과 같이 실패로 돌린다 — 엉뚱한 말을 보내느니 다시 보내게 하는 편이 낫다.
            boolean brokenRetry = false;
            java.util.Locale replyLanguage = DirectVideoPracticeLoop.replyLanguage(session, actorText);
            if (loop && message != null && DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(message).message(), replyLanguage)) {
                brokenRetry = true;
                ExternalOperationExecution.externalCall("model");
                message = replyOrNull(uploaded, history, prompt + "\n\n" + DirectVideoPracticeLoop.brokenRetryNote(replyLanguage), loop);
                if (message != null && DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(message).message(), replyLanguage)) {
                    message = null;
                }
            }
            if (message == null || message.isBlank()) throw new IllegalStateException("empty video coaching reply");
            DirectVideoDialogueEvidence.requireGrounded(uploaded, message, written);
            // 영상 시간("0:23", "0:03부터 0:46까지")으로 구간을 가리키면 한 번 다시 쓰게 한다. 배우는 시간으로 장면을 떠올리지 못한다.
            boolean timeRetry = false;
            if (loop && DirectVideoPracticeLoop.hasTimestamp(DirectVideoPracticeLoop.parse(message).message())) {
                timeRetry = true;
                ExternalOperationExecution.externalCall("model");
                String again = model.reply(uploaded, history, prompt + "\n\n"
                        + DirectVideoPracticeLoop.timestampRetryNote(DirectVideoPracticeLoop.replyLanguage(session, actorText)));
                if (again != null && !again.isBlank() && !DirectVideoPracticeLoop.parse(again).message().isBlank()) {
                    try {
                        DirectVideoDialogueEvidence.requireGrounded(uploaded, again, written);
                        message = again;
                    } catch (IllegalStateException ungrounded) {
                        // 다시 쓴 답이 근거 검사를 못 넘으면 처음 답을 쓰고 시간만 걷어낸다.
                    }
                }
            }
            var parsed = loop ? DirectVideoPracticeLoop.parse(message) : null;
            if (branch != null) {
                // 숨은 칸은 모델이 아니라 서버가 쓴다. 모델이 따라 쓴 태그는 parse 가 이미 걷어냈다.
                // 정리의 행동, 또는 정리 뒤 배우 해석을 받아 준 답의 행동을 노트의 다음 촬영으로 남긴다(뒤의 것이 앞의 것을 덮고, 숨은 줄이 없으면 앞의 것이 남는다).
                String status = branch.status(PracticeLoopRouter.WRAP_UP.equals(branch.doing()) ? DirectVideoPracticeLoop.nextTake(message)
                        : branch.acceptsReading() ? READING_LEAD.matcher(DirectVideoPracticeLoop.nextTake(message)).replaceFirst("") : "");
                DirectVideoDialogueEvidence.requireGrounded(uploaded, "<상태>\n" + status + "\n</상태>", written);
                parsed = new DirectVideoPracticeLoop.Parsed("", status, parsed.message());
            }
            // 배우에게는 코치 본문만 저장한다. 숨은 칸(<설계>·<상태>)은 아래에서 상태에 둔다.
            String shown = loop ? parsed.message() : message.strip();
            // 첫 응답에서 모델이 연기 영상이 아니라고 분류했으면 그 코치 문장은 버리고 끊는다.
            boolean cut = loop && session.turns().isEmpty() && DirectVideoPracticeLoop.notActing(parsed);
            if (cut) shown = DirectVideoPracticeLoop.notActingMessage(DirectVideoPracticeLoop.replyLanguage(session, actorText));
            // 첫 응답은 질문 한 문장이다. 앞에 붙인 인사·작품 설명 같은 군말은 걷어낸다.
            if (loop && !cut && session.turns().isEmpty()) shown = DirectVideoPracticeLoop.onlyFirstQuestion(shown);
            if (branch != null) {
                boolean last = PracticeLoopRouter.WRAP_UP.equals(branch.doing()) || branch.closeNext();
                // 정리와 정리 뒤 답은 질문하지 않는다. 질문 문장은 떼고, 다 떼면 원래 말을 둔다.
                // 그 밖의 말은 질문이 둘 이상이면 첫 질문까지만 남긴다.
                shown = last ? DirectVideoPracticeLoop.withoutQuestions(shown) : DirectVideoPracticeLoop.firstQuestionOnly(shown);
                // 배우가 방금 한 말을 첫 문장에서 그대로 되풀이하면 뗀다.
                shown = DirectVideoPracticeLoop.withoutEcho(shown, actorText);
            }
            // 배우가 대안을 말하지 않았는데 정리를 "맞아요, 그거예요"로 시작하면 그 인정 말을 뗀다.
            if (branch != null && PracticeLoopRouter.WRAP_UP.equals(branch.doing()) && !branch.actorFoundAlternative()) {
                shown = DirectVideoPracticeLoop.withoutAgreement(shown);
            }
            boolean timeStripped = false;
            if (loop && DirectVideoPracticeLoop.hasTimestamp(shown)) {
                shown = DirectVideoPracticeLoop.stripTimestamps(shown);
                timeStripped = true;
            }
            if (shown.isBlank()) throw new IllegalStateException("empty video coaching reply");
            // 앱이 코치 말을 아주 큰 글씨로 보여서 50자 안쪽이 목표다. 60자가 넘으면 자르지 않고 줄이기만 하는 호출로 두 번까지 줄인다.
            int shortened = 0;
            while (loop && !cut && shortened < 2 && DirectVideoPracticeLoop.displayLength(shown) > DirectVideoPracticeLoop.LONG_REPLY) {
                String shorter = shorten(shown, DirectVideoPracticeLoop.replyLanguage(session, actorText), persona, uploaded, written, operationId);
                shortened++;
                if (shorter == null) break;
                shown = shorter;
            }
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    model.model(), input, message, LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    null, LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(branch != null ? "fallback".equals(branch.classified().by()) : routeFallback),
                            "timestamp_retry", Boolean.toString(timeRetry), "timestamp_stripped", Boolean.toString(timeStripped),
                            "shorten_calls", Integer.toString(shortened), "empty_retry", Boolean.toString(emptyRetry), "broken_retry", Boolean.toString(brokenRetry),
                            "persona", persona))
                    .withPrompt(template));
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

    /**
     * 이 대화의 코치 성격(SOMA-622). 저장된 값이 있으면 그대로, 첫 응답이면 배정을 묻는다.
     * 배정이 실패하면 기본 성격으로 간다 — 코칭은 멈추지 않는다.
     */
    private String persona(CoachSessionSnapshot session, UUID operationId) {
        String stored = DirectVideoPracticeLoop.storedPersona(session.coachingState());
        if (!stored.isEmpty() || !session.turns().isEmpty()) return stored;
        try {
            String assigned = personas.assign(session);
            return assigned == null ? "" : assigned.strip();
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.UNEXPECTED, new FailureContext("DirectVideoCoach.persona", operationId));
            return "";
        }
    }

    private static String personaBlock(String persona, java.util.Locale language) {
        String text = DirectVideoPrompts.persona(persona, language);
        return text.isEmpty() ? "" : "\n\n" + text;
    }

    /**
     * 코치 AI 호출. 연습 루프에서는 빈 응답("empty video coaching reply")을 오류로 끝내지 않고 {@code null}로 돌려
     * 한 번 다시 쓰게 한다. 다른 실패는 그대로 던진다.
     */
    private String replyOrNull(DirectVideoModel.Video video, java.util.List<DirectVideoModel.Message> history, String prompt,
            boolean loop) {
        try {
            String reply = model.reply(video, history, prompt);
            return reply == null || reply.isBlank() ? null : reply;
        } catch (IllegalStateException empty) {
            if (loop && String.valueOf(empty.getMessage()).contains("empty")) return null;
            throw empty;
        }
    }

    /** 서버가 정한 이번 응답. 상태 칸과 모델에 줄 지시를 만든다. */
    private record Branch(PracticeLoopRouter.Classified classified, PracticeLoopRouter.Before before, String doing,
            String goal, java.util.List<String> avoid, String observed, String dialogue, boolean closeNext,
            String actorText, java.util.List<String> materials, String rootField) {

        String instruction(java.util.Locale language, String task) {
            // 쉽게 묻기는 이번에 알아낼 것(다음 단계의 목표)을 함께 준다.
            String withGoal = PracticeLoopRouter.EASY.equals(doing) ? task + "\n  이번에 알아낼 것: " + PracticeLoopRouter.easyGoal(before) : task;
            // 첫 응답이 찾은 근본 문제와 그 문제를 푸는 길을 매 턴 함께 준다.
            String root = DirectVideoPrompts.practiceLoopRoot(rootField, language);
            if (!root.isEmpty()) withGoal = withGoal + "\n\n" + root;
            // 정리 뒤 한 번 답하는 말이면 단계 질문으로 돌아가지 않는다 — 배우가 답하면 바로 닫히기 때문이다.
            String stage = closeNext ? lastWordLine(language, classified.kind()) : PracticeLoopRouter.stageLine(doing, before);
            return PracticeLoopRouter.instruction(language, doing, avoid, observed, dialogue, withGoal, stage, materials);
        }

        /** 배우가 4단계에서 대안을 말했는지(재료에 찾은 대안이 들어갔는지). */
        boolean actorFoundAlternative() {
            return materials.stream().anyMatch(line -> line.startsWith("배우가 말한 찾은 대안"));
        }

        String status() {
            return status("");
        }

        /**
         * 정리 뒤 마지막 답인지. 배우가 정리와 다른 해석을 냈으면 모델이 숨은 줄 &lt;다음 테이크&gt;에 배우 해석의 행동을 쓰고,
         * 그 줄이 있으면 노트의 다음 촬영을 덮는다. 다른 해석인지는 분류(반박·정정·물음·판단 요청)에 기대지 않고 모델이 본다
         * — "저는 조용히 협박하는 인물이라고 봤어요"는 반박으로 분류되지 않았다(dev 시험 2026-10-11).
         */
        boolean acceptsReading() {
            return closeNext;
        }

        private static String lastWordLine(java.util.Locale language, PracticeLoopRouter.Kind kind) {
            boolean korean = language == null || "ko".equals(language.getLanguage());
            boolean disagreed = kind == PracticeLoopRouter.Kind.PUSHBACK || kind == PracticeLoopRouter.Kind.CORRECTION;
            if (!korean) {
                return "this is the last thing you say today. Answer in one or two sentences and do not ask any question."
                        + (disagreed ? " The actor offered a different reading." : " If the actor offered a different reading of the character or a different action from your wrap-up:")
                        + " follow the actor's reading this time and do not go back to your earlier suggestion."
                        + " Write a hidden first line <다음 테이크>…</다음 테이크> with one action that follows the actor's reading, then say that action as"
                        + " \"you could try …\" and suggest checking in the next take whether it works. Do not give orders."
                        + (disagreed ? "" : " If the actor only asked something, just answer and do not write the hidden line.");
            }
            return "이번이 오늘 대화의 마지막 말이다. 물은 것에 한두 문장으로 답만 하고 질문하지 않는다. 아래 모양 칸의 \"질문\"은 이번에는 쓰지 않는다."
                    + (disagreed ? " 배우가 정리에 다른 해석을 냈다." : " 배우가 정리와 다른 인물 해석이나 다른 행동을 냈으면(\"저는 ~한 인물이라고 봤어요\", \"~하는 게 맞다고 생각했어요\"):")
                    + " 이번에는 배우의 해석을 따른다. 앞서 코치가 한 제안이나 근본 문제로 돌아가지 않는다."
                    + " 맨 첫 줄에 숨은 줄 <다음 테이크>…</다음 테이크>를 쓰고, 안에는 배우의 해석대로 다음 테이크에서 해 볼 행동 하나를 \"~해 봐도 좋아요\"로 끝나는 한 문장으로 쓴다(노트에 남는다. \"그 해석이면\" 같은 앞말 없이 행동만)."
                    + " 그다음 줄부터 그 행동을 \"~해 봐도 좋아요\"로 말하고, 그게 장면에서 통하는지 다음 테이크에서 확인해 보자고 한다."
                    + " \"~하세요\", \"~보여 주세요\", \"~해 봐요\"처럼 시키지 않는다. 예) 그 해석이면 소리 지르며 따져 봐도 좋아요. 다음 테이크에서 통하는지 확인해 봐요."
                    + (disagreed ? "" : " 배우가 묻기만 했으면 답만 하고 숨은 줄은 쓰지 않는다.");
        }

        /** 정리하기면 숨은 줄의 다음 테이크를 남긴다 — 노트의 다음 촬영이 이것을 쓴다. */
        String status(String nextTake) {
            return PracticeLoopRouter.status(observed, dialogue, classified, before, doing, goal, avoid,
                    nextTake == null ? "" : nextTake.strip(), closeNext, actorText);
        }
    }

    private Branch branch(CoachSessionSnapshot session, String actorText, UUID operationId) {
        var loopState = session.coachingState() == null ? null : session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY);
        int coachTurns = (int) session.turns().stream().filter(t -> "ai".equals(t.role())).count();
        var before = PracticeLoopRouter.before(loopState, coachTurns);
        var pressed = PracticeLoopRouter.button(actorText, before);
        var classified = pressed != null ? pressed : PracticeLoopRouter.forRouting(classify(session, actorText, operationId), before);
        String design = loopState == null ? "" : loopState.path("design").asText("");
        int stayed = PracticeLoopRouter.stayed(loopState, coachTurns);
        String doing = PracticeLoopRouter.route(classified.kind(), before, stayed);
        // "지금은 연습하기 어려워요" 버튼은 단계와 상관없이 바로 정리한다(그만·상한은 그대로 닫는다).
        if (PracticeLoopRouter.BY_LATER.equals(classified.by()) && !PracticeLoopRouter.END.equals(doing)) doing = PracticeLoopRouter.WRAP_UP;
        var avoid = PracticeLoopRouter.avoidAfter(before, classified.kind(), DirectVideoPracticeLoop.habit(design));
        String goal = DirectVideoPracticeLoop.goal(loopState == null ? null : loopState.path("statuses"), design);
        return new Branch(classified, before, doing, goal, avoid, DirectVideoPracticeLoop.statusField(design, "관찰 근거"),
                DirectVideoPracticeLoop.statusField(design, "대사 확인"), PracticeLoopRouter.closesNext(classified.kind(), before),
                actorText, withTries(materials(design, PracticeLoopRouter.answers(loopState, coachTurns), classified, before, actorText, doing),
                        doing, stayed, session),
                DirectVideoPracticeLoop.statusField(design, "근본 문제"));
    }

    /**
     * 긴 코치 말을 줄이기만 하는 호출(영상 없음). 뜻과 마지막 질문은 그대로 두고 50자 안쪽으로 다시 쓰게 한다.
     * 줄지 않았거나 비었거나 근거 검사를 못 넘으면 {@code null} — 부르는 쪽이 원래 말을 그대로 쓴다.
     */
    private String shorten(String text, java.util.Locale language, String persona, DirectVideoModel.Video video, String written, UUID operationId) {
        // 코치 말로 보이지 않는 글은 줄이지 않는다. 줄이면 엉뚱한 글이 그럴듯한 한국어 한 줄이 되어 버린다.
        if (DirectVideoPracticeLoop.looksBroken(text, language)) return null;
        try {
            ExternalOperationExecution.externalCall("model");
            String raw = model.reply(null, java.util.List.of(new DirectVideoModel.Message("user", text)),
                    DirectVideoPrompts.practiceLoopShorten(language) + DirectVideoPrompts.personaShortenNote(persona, language));
            if (raw == null || raw.isBlank()) return null;
            String shorter = DirectVideoPracticeLoop.parse(raw).message();
            if (DirectVideoPracticeLoop.hasTimestamp(shorter)) shorter = DirectVideoPracticeLoop.stripTimestamps(shorter);
            if (shorter.isBlank() || DirectVideoPracticeLoop.displayLength(shorter) >= DirectVideoPracticeLoop.displayLength(text)) return null;
            if (DirectVideoPracticeLoop.looksBroken(shorter, language)) return null;
            DirectVideoDialogueEvidence.requireGrounded(video, shorter, written);
            return shorter;
        } catch (IllegalStateException | IllegalArgumentException rejected) {
            return null;
        } catch (RuntimeException failure) {
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.shorten", operationId));
            return null;
        }
    }

    /** 이번 응답의 재료. 관찰 메모에서 버릇·가리는 것·살아 있는 곳·인물을, 상태 칸에서 배우가 단계마다 한 말을 꺼낸다. */
    /**
     * 같은 단계에 머물러 다시 물을 때, 이 단계에서 이미 한 코치 말과 이번이 몇 번째인지 준다.
     * 같은 프롬프트로 같은 질문을 되풀이하지 않게 하려는 것이다.
     */
    private static java.util.List<String> withTries(java.util.List<String> materials, String doing, int stayed, CoachSessionSnapshot session) {
        if (!PracticeLoopRouter.STAYS.contains(doing)) return materials;
        var coach = session.turns().stream().filter(t -> "ai".equals(t.role())).map(t -> t.text().replaceAll("\\s+", " ")).toList();
        var lines = new java.util.ArrayList<>(materials);
        lines.add("이 단계에서 이번이 " + (stayed + 2) + "번째 응답이다. 앞의 코치 말은 배우에게 통하지 않았다. 같은 말, 같은 모양으로 다시 묻지 않는다");
        for (int i = Math.max(0, coach.size() - stayed - 1); i < coach.size(); i++) lines.add("이 단계에서 이미 한 코치 말: " + coach.get(i));
        return lines;
    }

    private static java.util.List<String> materials(String design, java.util.Map<String, String> answers,
            PracticeLoopRouter.Classified classified, PracticeLoopRouter.Before before, String actorText, String doing) {
        var lines = new java.util.ArrayList<String>();
        java.util.function.BiConsumer<String, String> add = (label, value) -> {
            if (value != null && !value.isBlank() && !value.startsWith("없음")) lines.add(label + ": " + value.strip());
        };
        add.accept("정리에서 확인할 대사", DirectVideoPracticeLoop.statusField(design, "확인할 대사"));
        add.accept("이 배우의 문제", DirectVideoPracticeLoop.statusField(design, "버릇"));
        add.accept("왜 이 배우의 문제인가", DirectVideoPracticeLoop.statusField(design, "왜 이 배우의 문제인가"));
        add.accept("버릇이 가리는 것", DirectVideoPracticeLoop.statusField(design, "버릇이 가리는 것"));
        add.accept("다른 쪽 살아 있는 곳", DirectVideoPracticeLoop.statusField(design, "다른 쪽 살아 있는 곳"));
        add.accept("인물", DirectVideoPracticeLoop.statusField(design, "인물"));
        var known = new java.util.LinkedHashMap<>(answers);
        String field = PracticeLoopRouter.answerField(classified.kind(), before);
        if (field != null && actorText != null) known.put(field, actorText.strip()); // 방금 답한 단계 답도 재료로
        known.forEach((label, value) -> add.accept("배우가 말한 " + label, value));
        add.accept("배우가 방금 한 말", actorText == null ? null : actorText.replaceAll("\\s+", " "));
        if (classified.kind() == PracticeLoopRouter.Kind.METHOD && PracticeLoopRouter.GAP.equals(doing)) {
            lines.add("배우가 방법을 물었다. 방법을 말하기 전에, 무엇을 고쳐야 하는지부터 이번 단계로 보여 준다. 다음 질문에서 배우가 방법을 함께 찾는다");
        }
        switch (classified.respond()) {
            case "evaluation" -> lines.add("배우가 답하면서 코치의 판단도 물었다. 첫 문장에서 판단을 먼저 분명히 말하고(괜찮아요 / 조금 어색해요 / 아쉬워요), 이유는 근본 문제에 비춰 짧게 댄 뒤 이번 단계를 한다");
            case "question" -> lines.add("배우가 답하면서 물은 것이 있다. 첫 문장에서 쉬운 말로 바로 답하고, 이어서 이번 단계를 한다");
            case "method" -> lines.add("배우가 답하면서 방법도 물었다. 방법은 이번 단계에서 배우와 함께 찾는다. 짧게 받고 이번 단계를 한다");
            default -> { }
        }
        if (PracticeLoopRouter.WRAP_UP.equals(doing) && !known.containsKey("찾은 대안")) {
            lines.add("배우가 찾은 대안: 아직 없음. \"맞아요, 그거예요\"로 인정하지 말고, 근본 문제를 푸는 길 4단계와 배우의 첫 답을 살리는 행동 하나를 코치가 제안한다");
        }
        return lines;
    }

    /** 배우의 말 종류. 매번 분류만 하는 AI(영상 없음)에게 묻는다. 실패하면 보통 답으로 이어간다. */
    private PracticeLoopRouter.Classified classify(CoachSessionSnapshot session, String actorText, UUID operationId) {
        var transcript = new ArrayList<DirectVideoModel.Message>();
        // 이 세션의 대화 전체를 준다. 첫 비추기부터 봐야 정정·반박·선택 설명을 가릴 수 있다(상한 16턴이라 길지 않다).
        for (var turn : session.turns()) {
            transcript.add(new DirectVideoModel.Message("ai".equals(turn.role()) ? "model" : "user", turn.text()));
        }
        transcript.add(new DirectVideoModel.Message("user", actorText));
        Instant started = Instant.now();
        String output = "";
        String error = null;
        ExternalOperationExecution.externalCall("model");
        try {
            output = model.classify(java.util.List.copyOf(transcript), DirectVideoPrompts.practiceLoopClassifier(),
                    PracticeLoopRouter.SIGNALS);
            return PracticeLoopRouter.parse(output);
        } catch (RuntimeException failure) {
            error = failure.getClass().getSimpleName();
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.classify", operationId));
            return new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, false, "fallback");
        } finally {
            telemetry.record(new LlmCall(LlmStep.COACH_ROUTE, session.practiceSessionId(), session.userId(), model.model(),
                    DirectVideoPrompts.practiceLoopClassifier() + "\n" + transcript, output == null ? "" : output,
                    LlmTokens.unknown(), started, Duration.between(started, Instant.now()), error,
                    LlmCall.metadata("transport", "gemini_text_routing", "route", "practice_loop_classify"))
                    .withPrompt(new LlmPrompt("coach.practice-loop.classify", DirectVideoPrompts.practiceLoopClassifier())));
        }
    }

    /** 코치 AI 없이 닫을 때의 정해진 두 문장. 한국어가 아니면 영어. */
    static String fixedClosing(java.util.Locale language) {
        if (language == null || "ko".equals(language.getLanguage())) return "오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요.";
        return "That's it for today. Upload a new take and we'll pick up from here.";
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
