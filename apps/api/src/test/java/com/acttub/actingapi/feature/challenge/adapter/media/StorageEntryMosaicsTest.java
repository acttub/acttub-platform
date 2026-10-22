package com.acttub.actingapi.feature.challenge.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.concurrent.TimeUnit;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.integration.media.FaceDetector;
import com.acttub.actingapi.integration.media.FaceMosaicRenderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 원본 받기 → 모자이크 → 올리기(challenge.entry 얼굴 모자이크). 저장소는 흉내 내고 ffmpeg 는 진짜다(없으면 건너뛴다). */
class StorageEntryMosaicsTest {
    @TempDir Path temporary;
    private final VideoStorage storage = mock(VideoStorage.class);

    @Test void uploadsTheMosaicUnderItsKeyAndCleansUp() throws Exception {
        Path source = video();
        serve(source);
        var mosaics = new StorageEntryMosaics(storage, new FaceMosaicRenderer(() -> (bgr, width, height) ->
                List.of(new FaceDetector.Box(10, 10, 40, 40))));
        var uploaded = new java.util.ArrayList<Path>();
        doAnswer(call -> {
            Path file = call.getArgument(2, Path.class);
            assertThat(Files.size(file)).isPositive();
            uploaded.add(file);
            return null;
        }).when(storage).upload(eq("videos/u/r.mosaic-e.mp4"), eq("video/mp4"), any(Path.class));

        assertThat(mosaics.render("videos/u/r.mp4", "videos/u/r.mosaic-e.mp4")).isTrue();

        assertThat(uploaded).singleElement().satisfies(file -> assertThat(file).doesNotExist());
    }

    @Test void aVideoWithoutAFaceUploadsNothing() throws Exception {
        serve(video());
        var mosaics = new StorageEntryMosaics(storage, new FaceMosaicRenderer(() -> (bgr, width, height) -> List.of()));
        assertThat(mosaics.render("videos/u/r.mp4", "videos/u/r.mosaic-e.mp4")).isFalse();
        verify(storage, never()).upload(anyString(), anyString(), any());
    }

    @Test void storageFailuresSurfaceAndAvailabilityNeedsStorage() {
        doThrow(new IllegalStateException("storage down")).when(storage).download(anyString(), any());
        var mosaics = new StorageEntryMosaics(storage, new FaceMosaicRenderer(() -> (bgr, width, height) -> List.of()));
        assertThatThrownBy(() -> mosaics.render("videos/u/r.mp4", "k")).hasMessage("storage down");
        when(storage.configured()).thenReturn(false);
        assertThat(mosaics.available()).isFalse();
    }

    private void serve(Path source) {
        doAnswer(call -> {
            Files.copy(source, call.getArgument(1, Path.class), StandardCopyOption.REPLACE_EXISTING);
            return null;
        }).when(storage).download(eq("videos/u/r.mp4"), any(Path.class));
    }

    private Path video() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 건너뛴다");
        Path mp4 = temporary.resolve("take.mp4");
        int made = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=160x240:rate=30:duration=1",
                "-pix_fmt", "yuv420p", mp4.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD)
                .start().waitFor();
        assumeTrue(made == 0 && Files.size(mp4) > 0, "ffmpeg 가 시험 영상을 만들지 못해 건너뛴다");
        return mp4;
    }

    private static boolean ffmpegAvailable() {
        try {
            Process process = new ProcessBuilder(List.of("ffmpeg", "-version"))
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception missing) {
            return false;
        }
    }
}
