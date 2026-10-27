package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 첫 코칭 첫 말 A/B: 배정, 프롬프트 조립, 첫 응답 줄이기 예외. */
class DirectVideoCoachOpeningTest {
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final AtomicInteger asked = new AtomicInteger();

    static final String DESIGN = "<설계>\n인물: 혼자 선 척 붙잡히길 바란다\n순간1: \"됐어\" | 보이는: 상대가 물러나게 | 없는: 상대가 붙잡게\n</설계>\n";
    static final String B_LINES = "처음부터 끝까지 같은 높이로 말해요.\n상대를 보지 않고 바닥을 보며 말해요.\n다음 테이크에서는 한 번쯤 상대를 보고 말해 봐도 좋아요.\n이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?";

    DirectVideoCoachOpeningTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
    }

    DirectVideoCoach coach(CoachOpenings openings) {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0,
                CoachFlows.NONE, CoachVideoCache.NONE, true).withOpenings(openings);
    }

    CoachEngine engine(CoachOpenings openings) {
        return new CoachEngine(oldGenerator, failures, telemetry, true, java.util.Optional.of(coach(openings)));
    }

    CoachOpenings counting(String side) {
        return session -> {
            asked.incrementAndGet();
            return side;
        };
    }

    CoachSessionSnapshot first() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    String lastPrompt() {
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model, atLeastOnce()).reply(eq(file), anyList(), prompts.capture());
        return prompts.getValue();
    }

    @Test void assignmentIsAskedOnceForAFirstKoreanResponseAndTheStoredSideWins() {
        var session = first();
        assertThat(coach(counting(CoachOpenings.B)).opening(session, null, null)).isEqualTo(CoachOpenings.B);
        assertThat(asked.get()).isEqualTo(1);
        ObjectNode state = StructuredJson.MAPPER.createObjectNode();
        DirectVideoPracticeLoop.rememberOpening(state, "a");
        session = session.withCoachingState("three_layers_v1", 0, state, "open", "");
        assertThat(coach(counting(CoachOpenings.B)).opening(session, null, null)).isEqualTo(CoachOpenings.A);
        assertThat(asked.get()).isEqualTo(1);
    }

    @Test void conversationsWithoutAStoredSideAfterTheFirstResponseStayOnA() {
        var session = DirectVideoCoachBranchTest.looped("버릇: 담담함", List.of(""), "a", "코치 말", "배우 말");
        assertThat(coach(counting(CoachOpenings.B)).opening(session, "배우 말", null)).isEqualTo(CoachOpenings.A);
        assertThat(asked.get()).isZero();
    }

    @Test void nonKoreanAndFailedAssignmentsStayOnA() {
        assertThat(coach(counting(CoachOpenings.B)).opening(first(), "I wanted him to stay and listen to me.", null)).isEqualTo(CoachOpenings.A);
        assertThat(asked.get()).isZero();
        assertThat(coach(session -> { throw new IllegalStateException("db down"); }).opening(first(), null, UUID.randomUUID()))
                .isEqualTo(CoachOpenings.A);
    }

    @Test void promptBlocksArePresentOnlyForKoreanB() {
        assertThat(DirectVideoPrompts.openingBlock(CoachOpenings.B, null)).contains("[첫 응답").contains("180자");
        assertThat(DirectVideoPrompts.openingBlock(CoachOpenings.B, Locale.KOREAN)).isNotEmpty();
        assertThat(DirectVideoPrompts.openingBlock(CoachOpenings.A, null)).isEmpty();
        assertThat(DirectVideoPrompts.openingBlock(CoachOpenings.B, Locale.ENGLISH)).isEmpty();
        assertThat(DirectVideoPrompts.openingTurnBlock(CoachOpenings.B, null)).isNotEmpty();
        assertThat(DirectVideoPrompts.openingTurnBlock(CoachOpenings.A, null)).isEmpty();
        assertThat(DirectVideoPrompts.openingTurnBlock(CoachOpenings.B, Locale.ENGLISH)).isEmpty();
    }

    @Test void sideBFirstResponseEndsWithTheBlockKeepsAllLinesAndSkipsShortening() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DESIGN + "<코치>\n" + B_LINES + "\n</코치>");
        var result = engine(session -> CoachOpenings.B).start(first(), UUID.randomUUID());
        assertThat(lastPrompt()).endsWith(DirectVideoPrompts.openingBlock(CoachOpenings.B, null));
        assertThat(result.reply().message()).isEqualTo(B_LINES);
        assertThat(DirectVideoPracticeLoop.displayLength(B_LINES)).isGreaterThan(DirectVideoPracticeLoop.LONG_REPLY);
        verify(model, never()).replyLight(any(), anyList(), anyString());
        assertThat(DirectVideoPracticeLoop.storedOpening(result.session().coachingState())).isEqualTo(CoachOpenings.B);
    }

    @Test void sideAFirstResponseHasNoBlockAndStillKeepsOnlyTheQuestion() {
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DESIGN + "<코치>\n" + B_LINES + "\n</코치>");
        var result = engine(CoachOpenings.NONE).start(first(), UUID.randomUUID());
        assertThat(lastPrompt()).doesNotContain(DirectVideoPrompts.openingBlock(CoachOpenings.B, null).strip());
        assertThat(result.reply().message()).isEqualTo("이 장면에서 인물은 상대한테서 결국 뭘 얻어 내고 싶었어요?");
        assertThat(DirectVideoPracticeLoop.storedOpening(result.session().coachingState())).isEqualTo(CoachOpenings.A);
    }
}
