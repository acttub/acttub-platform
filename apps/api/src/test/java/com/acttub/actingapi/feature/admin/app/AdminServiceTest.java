package com.acttub.actingapi.feature.admin.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.integration.storage.NoCredentialsError;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class AdminServiceTest {

    @Test
    void challengePlaybackUsesMockSignerWithFixedTtlAndAllExclusions() {
        AdminMetricsRepository metrics = mock(AdminMetricsRepository.class);
        AdminPlayback playback = mock(AdminPlayback.class);
        AdminService service = new AdminService(metrics, playback, "Team@Acttub.com");
        UUID entryId = UUID.randomUUID();
        List<String> actors = List.of("1234abcd");
        when(metrics.challengeVideoObjectKey(entryId, List.of("Team@Acttub.com"), actors))
                .thenReturn(Optional.of("challenge/take.mp4"));
        when(playback.requiredUrl("challenge/take.mp4", 600)).thenReturn("https://signed.test/video");

        assertThat(service.challengeVideoPlayback(entryId, actors))
                .isEqualTo(new AdminMetrics.AdminChallengePlayback("https://signed.test/video", 600));
        verify(playback).requiredUrl("challenge/take.mp4", 600);
    }

    @Test
    void challengePlaybackUsesTheSameNotFoundForMissingOrExcludedRows() {
        AdminMetricsRepository metrics = mock(AdminMetricsRepository.class);
        AdminPlayback playback = mock(AdminPlayback.class);
        AdminService service = new AdminService(metrics, playback, "team@acttub.com");
        UUID entryId = UUID.randomUUID();
        when(metrics.challengeVideoObjectKey(entryId, List.of("team@acttub.com"), List.of()))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.challengeVideoPlayback(entryId, List.of()))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(404);
                    assertThat(failure.getMessage()).isEqualTo("challenge_video_not_found");
                });
        verifyNoInteractions(playback);
    }

    @Test
    void challengePlaybackMapsStorageAbsenceToServiceUnavailable() {
        assertPlaybackUnavailable(new NoCredentialsError("storage is not configured"));
    }

    @Test
    void challengePlaybackMapsSigningFailureToServiceUnavailable() {
        assertPlaybackUnavailable(new IllegalStateException("signing failed"));
    }

    private static void assertPlaybackUnavailable(RuntimeException cause) {
        AdminMetricsRepository metrics = mock(AdminMetricsRepository.class);
        AdminPlayback playback = mock(AdminPlayback.class);
        AdminService service = new AdminService(metrics, playback, "");
        UUID entryId = UUID.randomUUID();
        when(metrics.challengeVideoObjectKey(entryId, List.of(), List.of()))
                .thenReturn(Optional.of("challenge/take.mp4"));
        when(playback.requiredUrl("challenge/take.mp4", 600)).thenThrow(cause);

        assertThatThrownBy(() -> service.challengeVideoPlayback(entryId, List.of()))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.status()).isEqualTo(503);
                    assertThat(failure.getMessage()).isEqualTo("playback_unavailable");
                    assertThat(failure.getCause()).isSameAs(cause);
                });
    }
}
