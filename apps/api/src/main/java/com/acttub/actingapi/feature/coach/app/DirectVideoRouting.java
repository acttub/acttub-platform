package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Collectors;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTokens;

/** Classifies actor messages separately, then selects prompts in code. Model labels never close a session. */
final class DirectVideoRouting {
    static final List<String> CATEGORIES = List.of("intention", "correction", "unsure", "method", "acknowledgement", "other");
    private final DirectVideoModel model;
    private final FailureReporter failures;
    private final Consumer<LlmCall> record;

    DirectVideoRouting(DirectVideoModel model, FailureReporter failures, Consumer<LlmCall> record) {
        this.model = model;
        this.failures = failures;
        this.record = record;
    }

    record Selection(List<DirectVideoRoute> routes, boolean fallback) {
        Selection { routes = List.copyOf(routes); }
        String prompt() { return DirectVideoPrompts.forRoutes(routes); }
        String label() { return routes.stream().map(route -> route.id).collect(Collectors.joining("+")); }
    }

    Selection select(List<DirectVideoModel.Message> history, String actorText, boolean finish,
            UUID practiceId, UUID userId, UUID operationId) {
        if (finish) return new Selection(List.of(DirectVideoRoute.CLOSING), false);
        if (actorText == null) return new Selection(List.of(DirectVideoRoute.OPENING), false);
        Instant started = Instant.now();
        String output = "";
        String error = null;
        // A lost operation lease must not fall back to another model call.
        ExternalOperationExecution.externalCall("model");
        try {
            output = model.classify(List.copyOf(history), DirectVideoPrompts.classifier(), CATEGORIES);
            return new Selection(parse(output), false);
        } catch (RuntimeException failure) {
            error = failure.getClass().getSimpleName();
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoRouting.classify", operationId));
            return new Selection(List.of(DirectVideoRoute.GENERAL), true);
        } finally {
            record.accept(new LlmCall(LlmStep.COACH_ROUTE, practiceId, userId, model.model(),
                    DirectVideoPrompts.classifier() + "\n" + history, output == null ? "" : output,
                    LlmTokens.unknown(), started, Duration.between(started, Instant.now()), error,
                    LlmCall.metadata("transport", "gemini_text_routing")));
        }
    }

    static List<DirectVideoRoute> parse(String output) {
        var root = StructuredJson.parse(output);
        if (!root.isObject() || root.size() != 1 || !root.path("signals").isArray()
                || root.path("signals").size() > CATEGORIES.size()) {
            throw new IllegalArgumentException("invalid direct video classification");
        }
        var signals = EnumSet.noneOf(DirectVideoRoute.class);
        for (var value : root.path("signals")) {
            if (!value.isTextual() || !CATEGORIES.contains(value.asText())) {
                throw new IllegalArgumentException("unknown direct video classification");
            }
            var route = DirectVideoRoute.valueOf(value.asText().toUpperCase(java.util.Locale.ROOT));
            if (!signals.add(route)) throw new IllegalArgumentException("duplicate direct video classification");
        }
        // Correct a wrong premise first; confusion needs explanation before a method.
        if (signals.contains(DirectVideoRoute.CORRECTION)) {
            if (signals.contains(DirectVideoRoute.UNSURE)) return List.of(DirectVideoRoute.CORRECTION, DirectVideoRoute.UNSURE);
            if (signals.contains(DirectVideoRoute.METHOD)) return List.of(DirectVideoRoute.CORRECTION, DirectVideoRoute.METHOD);
            return List.of(DirectVideoRoute.CORRECTION);
        }
        for (var route : List.of(DirectVideoRoute.UNSURE, DirectVideoRoute.METHOD,
                DirectVideoRoute.INTENTION, DirectVideoRoute.OTHER, DirectVideoRoute.ACKNOWLEDGEMENT)) {
            if (signals.contains(route)) return List.of(route);
        }
        return List.of(DirectVideoRoute.OTHER);
    }
}
