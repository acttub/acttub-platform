package com.acttub.actingapi.feature.admin.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

/** 서명기가 빈 주소를 주면 재생은 503 이고, ops 코어가 객체가 아니면 운영 화면이 잘못된 숫자를 보이지 않는다. */
class AdminServicePlaybackFailureTest {
    private final AdminMetricsRepository metrics = mock(AdminMetricsRepository.class);
    private final AdminPlayback playback = mock(AdminPlayback.class);
    private final AdminService service = new AdminService(metrics, playback, "", "");

    private static Consumer<Throwable> unavailableBecauseTheUrlIsBlank() {
        return failure -> {
            assertThat(failure).isInstanceOf(ApiException.class);
            assertThat(((ApiException) failure).status()).isEqualTo(503);
            assertThat(failure.getMessage()).isEqualTo("playback_unavailable");
            assertThat(failure.getCause()).hasMessage("admin playback signer returned no URL");
        };
    }

    @Test
    void blankSignedUrlMakesEveryPlaybackUnavailable() {
        UUID id = UUID.randomUUID();
        when(metrics.challengeVideoObjectKey(eq(id), anyList(), anyList())).thenReturn(Optional.of("c.mp4"));
        when(metrics.uploadOnlyVideoObjectKey(eq(id), anyList(), anyList())).thenReturn(Optional.of("u.mp4"));
        when(metrics.readingRecordingObjectKey(eq(id), anyList(), anyList())).thenReturn(Optional.of("r.m4a"));
        when(playback.requiredUrl(eq("c.mp4"), anyInt())).thenReturn(null);
        when(playback.requiredUrl(eq("u.mp4"), anyInt())).thenReturn(" ");
        when(playback.requiredUrl(eq("r.m4a"), anyInt())).thenReturn("");

        assertThatThrownBy(() -> service.challengeVideoPlayback(id, List.of()))
                .satisfies(unavailableBecauseTheUrlIsBlank());
        assertThatThrownBy(() -> service.uploadOnlyVideoPlayback(id, List.of()))
                .satisfies(unavailableBecauseTheUrlIsBlank());
        assertThatThrownBy(() -> service.readingRecordingPlayback(id, List.of()))
                .satisfies(unavailableBecauseTheUrlIsBlank());
    }

    @Test
    void opsCoreThatIsNotAJsonObjectIsRejected() {
        when(metrics.opsCore(anyList(), anyList())).thenReturn("[1,2]", "not json", "{\"users\":3}");

        assertThatThrownBy(() -> service.opsCore(List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("ops core query did not return a JSON object");
        assertThatThrownBy(() -> service.opsCore(List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("ops core query did not return a JSON object");
        assertThat(service.opsCore(List.of()).path("users").asInt()).isEqualTo(3);
        assertThat(service.opsCore(List.of()).path("source").asText()).isEqualTo("live");
    }

    @Test
    void advisorListThatIsNotOnTheClasspathStopsStartup() {
        assertThatThrownBy(() -> AdminService.advisorEmailHashes("/admin/no-such-advisors.txt"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("missing advisor list: /admin/no-such-advisors.txt");
        assertThat(AdminService.advisorEmailHashes(" ")).isEmpty();
        assertThat(AdminService.advisorEmailHashes(null)).isEmpty();
    }
}
