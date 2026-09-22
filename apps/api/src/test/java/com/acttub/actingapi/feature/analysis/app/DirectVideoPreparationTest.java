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

    private AnalysisContext context(String version) {
        return new AnalysisContext(UUID.randomUUID(), UUID.randomUUID(), "original", "video/mp4", "etag", 8000,
                "", "", "", "그 외", "", version, UUID.randomUUID());
    }
}
