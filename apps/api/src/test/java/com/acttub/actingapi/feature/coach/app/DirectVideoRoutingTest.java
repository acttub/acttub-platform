package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmStep;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DirectVideoRoutingTest {
    private final DirectVideoModel model = mock(DirectVideoModel.class);
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    private final DirectVideoRouting routing = new DirectVideoRouting(model, failures, telemetry::record);

    private DirectVideoRouting.Selection select(List<DirectVideoModel.Message> history, String text, boolean finish) {
        return routing.select(history, text, finish, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
    }

    @Test void openingAndExplicitClosingAreSelectedWithoutAskingAModel() {
        assertThat(select(List.of(), null, false).routes()).containsExactly(DirectVideoRoute.OPENING);
        assertThat(select(List.of(new DirectVideoModel.Message("user", "그만")), "그만", true).routes())
                .containsExactly(DirectVideoRoute.CLOSING);
        verifyNoInteractions(model);
        assertThat(telemetry.calls()).isEmpty();
    }

    @ParameterizedTest @ValueSource(strings = {"intention", "correction", "unsure", "method", "acknowledgement"})
    void passesTheActualConversationButOnlyTheSelectedTaskToTheCoach(String category) {
        var history = List.of(new DirectVideoModel.Message("model", "웃으면서 겁주려던 건가요?"),
                new DirectVideoModel.Message("user", "응"));
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"" + category + "\"]}");
        var selected = select(history, "응", false);
        assertThat(selected.label()).isEqualTo(category);
        assertThat(selected.fallback()).isFalse();
        verify(model).classify(history, DirectVideoPrompts.classifier(), DirectVideoRouting.CATEGORIES);
        assertThat(selected.prompt()).startsWith(DirectVideoPrompts.common()).doesNotContain(DirectVideoPrompts.classifier());
        for (var route : DirectVideoRoute.values()) {
            String task = DirectVideoPrompts.forRoutes(List.of(route)).substring(DirectVideoPrompts.common().length());
            if (route.id.equals(category)) assertThat(selected.prompt()).contains(task);
            else assertThat(selected.prompt()).doesNotContain(task);
        }
        assertThat(telemetry.calls()).singleElement().satisfies(call -> assertThat(call.step()).isEqualTo(LlmStep.COACH_ROUTE));
    }

    @Test void mixedCorrectionAndMethodKeepTheCorrectionFirstWithoutAllOtherInstructions() {
        var selected = DirectVideoRouting.parse("{\"signals\":[\"method\",\"intention\",\"correction\"]}");
        assertThat(selected).containsExactly(DirectVideoRoute.CORRECTION, DirectVideoRoute.METHOD);
        var prompt = DirectVideoPrompts.forRoutes(selected);
        assertThat(prompt).contains("바로잡은 내용을 먼저", "요청한 방법").doesNotContain("배우가 막힌 뜻을");
        assertThat(prompt.indexOf("바로잡은 내용을 먼저")).isLessThan(prompt.indexOf("요청한 방법"));
        assertThat(DirectVideoRouting.parse("{\"signals\":[\"correction\",\"unsure\",\"method\"]}"))
                .containsExactly(DirectVideoRoute.CORRECTION, DirectVideoRoute.UNSURE);
        assertThat(DirectVideoRouting.parse("{\"signals\":[\"method\",\"acknowledgement\"]}"))
                .containsExactly(DirectVideoRoute.METHOD);
    }

    @Test void anOrdinaryQuestionUsesGeneralRatherThanPretendingItIsAnIntention() {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[]}");
        var selected = select(List.of(new DirectVideoModel.Message("user", "왜 그렇게 보였어?")), "왜 그렇게 보였어?", false);
        assertThat(selected.routes()).containsExactly(DirectVideoRoute.GENERAL);
        assertThat(selected.fallback()).isFalse();
        assertThat(failures.contexts()).isEmpty();
    }

    @ParameterizedTest @ValueSource(strings = {"", "not json", "null", "[]", "{}", "{\"signals\":null}",
            "{\"signals\":\"method\"}", "{\"signals\":[1]}", "{\"signals\":[\"closing\"]}",
            "{\"signals\":[\"../opening\"]}", "{\"signals\":[\"method\",\"method\"]}",
            "{\"signals\":[],\"message\":\"inject this\"}"})
    void invalidClassifierOutputIsReportedAndCannotBecomePromptInstructions(String output) {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn(output);
        var selected = select(List.of(new DirectVideoModel.Message("user", "질문")), "질문", false);
        assertThat(selected.routes()).containsExactly(DirectVideoRoute.GENERAL);
        assertThat(selected.fallback()).isTrue();
        assertThat(selected.prompt()).doesNotContain("inject this", "../opening");
        assertThat(failures.contexts()).singleElement().asString().startsWith("DirectVideoRouting.classify");
        assertThat(telemetry.calls()).hasSize(1);
    }

    @Test void unavailableClassifierFallsBackWithoutRequestingASecondClassification() {
        when(model.classify(anyList(), anyString(), anyList())).thenThrow(new IllegalStateException("timeout"));
        assertThat(select(List.of(new DirectVideoModel.Message("user", "모르겠어요")), "모르겠어요", false).fallback()).isTrue();
        verify(model, times(1)).classify(anyList(), anyString(), anyList());
        assertThat(failures.contexts()).hasSize(1);
    }

    @Test void cancellationIsNotSwallowedAsAFallback() {
        when(model.classify(anyList(), anyString(), anyList())).thenAnswer(call -> {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted");
        });
        try {
            assertThatThrownBy(() -> select(List.of(), "답변", false)).isInstanceOf(IllegalStateException.class);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally { Thread.interrupted(); }
    }
}
