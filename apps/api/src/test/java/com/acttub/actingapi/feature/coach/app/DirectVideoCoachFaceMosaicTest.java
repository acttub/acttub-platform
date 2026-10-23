package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.media.FaceMosaic;
import com.acttub.actingapi.integration.media.FaceMosaicRenderer;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 얼굴 가리기 회차(practice.start): 코치는 원본이 아니라 가린 사본만 올리고, 표정을 말하지 말라는 한 줄을 받는다. */
class DirectVideoCoachFaceMosaicTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final List<String> uploadedBytes = new ArrayList<>();
    final List<Path> rendered = new ArrayList<>();

    DirectVideoCoachFaceMosaicTest() {
        when(storage.downloadToPath(eq("owned/video.mov"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/quicktime", "\"etag\"");
        });
        when(model.upload(any(), anyString())).thenAnswer(call -> {
            uploadedBytes.add(Files.readString(call.getArgument(0)) + " as " + call.getArgument(1));
            return file;
        });
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);
    }

    void source(boolean faceMosaic) {
        when(videos.find(any(), any())).thenReturn(
                new CoachVideoSource.Video("owned/video.mov", "video/quicktime", "etag", faceMosaic));
    }

    DirectVideoCoach coach() {
        return new DirectVideoCoach(model, videos, storage, new RecordingFailureReporter(), new RecordingLlmTelemetry(), true);
    }

    FaceMosaic masking() {
        return new FaceMosaic() {
            @Override public boolean available() { return true; }
            @Override public Path render(Path source) throws Exception {
                rendered.add(source);
                Path out = Files.createTempFile(source.toAbsolutePath().getParent(), "masked-", ".mp4");
                Files.writeString(out, "masked " + Files.readString(source));
                rendered.add(out);
                return out;
            }
        };
    }

    static CoachSessionSnapshot fresh() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void theCoachUploadsOnlyTheMaskedCopyAndIsToldNotToJudgeTheFace() {
        source(true);
        var result = coach().withFaceMosaic(masking()).turn(fresh(), null, UUID.randomUUID());

        assertThat(result.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        assertThat(uploadedBytes).containsExactly("masked original video bytes as video/mp4");
        assertThat(rendered).as("원본과 사본 임시 파일을 모두 지운다").hasSize(2).allSatisfy(path -> assertThat(path).doesNotExist());
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getValue()).startsWith(DirectVideoPrompts.FACE_MOSAIC_FACT + "\n\n");
    }

    @Test void withoutARendererTheOriginalIsNeverUploaded() {
        source(true);
        assertThatThrownBy(() -> coach().turn(fresh(), null, UUID.randomUUID())).isInstanceOf(RuntimeException.class);
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).reply(any(), anyList(), anyString());
    }

    @Test void aVideoWithNoFaceIsUploadedAsTheOriginalInItsOwnFormat() {
        source(true);
        FaceMosaic none = new FaceMosaic() {
            @Override public boolean available() { return true; }
            @Override public Path render(Path source) throws Exception { throw new FaceMosaicRenderer.NoFaceFound(); }
        };
        coach().withFaceMosaic(none).turn(fresh(), null, UUID.randomUUID());

        // 얼굴이 아예 없으면 가릴 것이 없으니 원본을 원본 형식 그대로 올린다(10/23 결정).
        assertThat(uploadedBytes).containsExactly("original video bytes as video/quicktime");
        verify(model).reply(eq(file), anyList(), anyString());
    }

    @Test void aPracticeWithoutFaceMosaicKeepsTheOriginalAndGetsNoFaceLine() {
        source(false);
        coach().withFaceMosaic(masking()).turn(fresh(), null, UUID.randomUUID());

        assertThat(rendered).isEmpty();
        assertThat(uploadedBytes).containsExactly("original video bytes as video/quicktime");
        var prompts = ArgumentCaptor.forClass(String.class);
        verify(model).reply(eq(file), anyList(), prompts.capture());
        assertThat(prompts.getValue()).doesNotContain(DirectVideoPrompts.FACE_MOSAIC_FACT);
    }

    @Test void theMaskedCopyUsesItsOwnCacheKeySoAnOriginalWarmupIsNeverTaken() {
        assertThat(CoachVideoCache.faceMosaicSource("owned/video.mov")).isNotEqualTo("owned/video.mov");
        assertThat(CoachVideoCache.faceMosaicSource(null)).isNull();
    }
}
