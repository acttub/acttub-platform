package com.acttub.actingapi.feature.admin.adapter.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

class ObjectStorageAdminPlaybackTest {

    @Test
    void requiredPlaybackPassesTheExactTtlToStorage() {
        ObjectStorage storage = mock(ObjectStorage.class);
        when(storage.presignPlayback("challenge/take.mp4", 600)).thenReturn("signed");
        ObjectStorageAdminPlayback playback = new ObjectStorageAdminPlayback(
                Optional.of(storage), new RecordingFailureReporter());

        assertThat(playback.requiredUrl("challenge/take.mp4", 600)).isEqualTo("signed");
        verify(storage).presignPlayback("challenge/take.mp4", 600);
    }

    @Test
    void requiredPlaybackFailsWhenStorageIsNotConfigured() {
        ObjectStorageAdminPlayback playback = new ObjectStorageAdminPlayback(
                Optional.empty(), new RecordingFailureReporter());

        assertThatThrownBy(() -> playback.requiredUrl("challenge/take.mp4", 600))
                .isInstanceOf(NoCredentialsError.class);
    }

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
        assertThatThrownBy(() -> playback.requiredUrl("sessions/take.mp4", 900))
                .isSameAs(failure);
    }
}
