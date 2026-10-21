package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DirectVideoPreparationTest {
    @Test void videoOnlyUploadIsPreparedWithoutCallingAnyAnalysisModel() {
        var legacy = mock(AnalysisProcessor.class);
        var duration = mock(DurationResolver.class);
        var path = Path.of("original.mp4");
        when(duration.durationMs(path, 8000)).thenReturn(8000);
        var processor = new DirectVideoPreparation(duration, legacy);
        var result = processor.analyze(path, context("three_layers_v1"));
        assertThat(result.durationMs()).isEqualTo(8000);
        assertThat(result.wasCompressed()).isFalse();
        assertThat(result.videoRecord()).isNull();
        assertThat(result.observationPack().observations()).isEmpty();
        verifyNoInteractions(legacy);
    }

    @Test void existingLegacyPracticeKeepsItsAnalysisPath() {
        var legacy = mock(AnalysisProcessor.class);
        var duration = mock(DurationResolver.class);
        var path = Path.of("original.mp4");
        var context = context("legacy");
        new DirectVideoPreparation(duration, legacy).analyze(path, context);
        verify(legacy).analyze(path, context);
        verifyNoInteractions(duration);
    }

    @Test void directVideoPracticeHandsTheDownloadedFileToTheCoachWarmup() {
        var legacy = mock(AnalysisProcessor.class);
        var duration = mock(DurationResolver.class);
        var warmup = mock(DirectVideoWarmup.class);
        var path = Path.of("original.mp4");
        var context = context("three_layers_v1");
        when(duration.durationMs(path, 8000)).thenReturn(8000);
        new DirectVideoPreparation(duration, legacy, warmup).analyze(path, context);
        verify(warmup).warm(context, path);
    }

    @Test void aFailingWarmupNeverChangesTheAnalysisResult() {
        var duration = mock(DurationResolver.class);
        var path = Path.of("original.mp4");
        when(duration.durationMs(path, 8000)).thenReturn(8000);
        DirectVideoWarmup broken = (context, file) -> { throw new IllegalStateException("gemini down"); };
        var result = new DirectVideoPreparation(duration, mock(AnalysisProcessor.class), broken)
                .analyze(path, context("three_layers_v1"));
        assertThat(result.durationMs()).isEqualTo(8000);
    }

    @Test void legacyPracticeIsNotWarmed() {
        var warmup = mock(DirectVideoWarmup.class);
        new DirectVideoPreparation(mock(DurationResolver.class), mock(AnalysisProcessor.class), warmup)
                .analyze(Path.of("original.mp4"), context("legacy"));
        verifyNoInteractions(warmup);
    }

    private AnalysisContext context(String version) {
        return new AnalysisContext(UUID.randomUUID(), UUID.randomUUID(), "original", "video/mp4", "etag", 8000,
                "", "", "", "그 외", "", version, UUID.randomUUID());
    }
}
