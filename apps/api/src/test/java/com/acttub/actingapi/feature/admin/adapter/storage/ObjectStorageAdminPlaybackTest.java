package com.acttub.actingapi.feature.admin.adapter.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Optional;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

class ObjectStorageAdminPlaybackTest {

    @Test
    void playbackSigningFailureReturnsNullAndIsReportedAsExternal() {
        RuntimeException failure = new RuntimeException("storage unavailable");
        ObjectStorage storage = mock(ObjectStorage.class);
        when(storage.presignPlayback("sessions/take.mp4", 900)).thenThrow(failure);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ObjectStorageAdminPlayback playback = new ObjectStorageAdminPlayback(
                Optional.of(storage), reporter);

        assertThat(playback.url("sessions/take.mp4", 900)).isNull();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context())
                    .isEqualTo("ObjectStorageAdminPlayback.url");
        });
    }
}
