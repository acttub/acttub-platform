package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** 한 대화 안에서 올린 영상을 다시 쓴다(SOMA-735). */
class CoachVideoCacheTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-16T07:00:00Z"));
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final DirectVideoModel.Video other = new DirectVideoModel.Video("files/other", "gemini://other", "video/mp4");
    final List<Path> temporary = new ArrayList<>();

    CoachVideoCacheTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            temporary.add(path);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("말끝을 가볍게 던진 선택이 보여요. 장난스럽게 겁주려는 건가요?");
    }

    CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    CoachEngine engine(CoachVideoCache cache) {
        var direct = new DirectVideoCoach(model, videos, storage, failures, telemetry, false, CoachPersonas.NONE,
                null, 0, CoachFlows.NONE, cache);
        return new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(direct));
    }

    @Test void secondReplyReusesTheVideoUploadedForTheFirstReply() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        var second = engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        assertThat(second.session().turns()).hasSize(3);
        // 내려받기·올리기는 첫 답에서 한 번뿐이고, 대화가 열려 있는 동안은 지우지 않는다.
        verify(storage, times(1)).downloadToPath(any(), any());
        verify(model, times(1)).upload(any(), eq("video/mp4"));
        verify(model, never()).delete(any());
        verify(model, times(2)).reply(eq(file), anyList(), anyString());
        assertThat(cache.size()).isEqualTo(1);
        assertThat(telemetry.calls()).last().satisfies(call ->
                assertThat(call.metadata()).containsEntry("video_reused", "true"));
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        cache.close();
        verify(model).delete(file);
        assertThat(cache.size()).isZero();
    }

    @Test void disabledCacheKeepsUploadingAndDeletingEveryReply() {
        var engine = engine(CoachVideoCache.NONE);
        var first = engine.start(session(), UUID.randomUUID());
        engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model, times(2)).upload(any(), eq("video/mp4"));
        verify(model, times(2)).delete(file);
    }

    @Test void failedReplyDeletesTheRememberedVideoAndTheNextReplyUploadsAgain() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        when(model.reply(eq(file), anyList(), anyString())).thenThrow(new IllegalStateException("provider down"));
        assertThatThrownBy(() -> engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        verify(model, times(1)).delete(file);
        assertThat(cache.size()).isZero();
    }

    @Test void expiredVideoFromTheGeminiSideIsUploadedAgain() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        // 기억은 남았지만 Gemini 쪽에서 사라졌다 — 첫 확인은 실패, 새로 올린 영상은 준비됨.
        when(model.ready(file)).thenThrow(new IllegalStateException("404")).thenReturn(true);
        engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model, times(2)).upload(any(), eq("video/mp4"));
        assertThat(cache.size()).isEqualTo(1);
    }

    @Test void idleVideoIsDeletedAndChangedOriginalIsNotReused() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        var key = new CoachVideoCache.Key(practice, "owned/video.mp4", "etag");
        cache.keep(key, file);
        assertThat(cache.take(key)).isEqualTo(file);
        // 원본이 바뀌면 옛 영상은 지우고 다시 쓰지 않는다.
        assertThat(cache.take(new CoachVideoCache.Key(practice, "owned/video.mp4", "etag-2"))).isNull();
        verify(model).delete(file);
        assertThat(cache.size()).isZero();

        cache.keep(key, other);
        clock.advance(Duration.ofMinutes(19));
        assertThat(cache.take(key)).isEqualTo(other);
        clock.advance(Duration.ofMinutes(19));
        cache.sweep();
        // 마지막으로 쓴 뒤 20분이 안 지났다.
        assertThat(cache.size()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(2));
        cache.sweep();
        assertThat(cache.size()).isZero();
        verify(model).delete(other);
        cache.close();
    }

    @Test void deleteFailureIsReportedNotThrown() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        cache.keep(new CoachVideoCache.Key(practice, "k", "e"), file);
        doThrow(new IllegalStateException("delete failed")).when(model).delete(file);
        assertThat(cache.forget(practice)).isEqualTo(file);
        assertThat(failures.contexts()).contains("CoachVideoCache.delete");
        cache.close();
    }
}
