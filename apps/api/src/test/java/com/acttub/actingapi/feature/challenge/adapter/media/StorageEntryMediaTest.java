package com.acttub.actingapi.feature.challenge.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

/** challenge.entry: 참여작의 길이는 저장된 객체를 읽어 잰 값이고, 읽을 수 없는 객체는 422 video_not_ready 다. */
class StorageEntryMediaTest {
    private final List<List<String>> commands = new ArrayList<>();

    private StorageEntryMedia media(int exit, String output) {
        VideoStorage storage = new VideoStorage() {
            @Override public void requireConfigured() { }
            @Override public String presignUpload(String key, String type, long size, int seconds) { return null; }
            @Override public String presignPlayback(String key, int seconds) { return "https://storage.test/" + key; }
            @Override public Stored head(String key) { return null; }
        };
        return new StorageEntryMedia(storage, command -> {
            commands.add(command);
            return new StorageEntryMedia.Probe.Result(exit, output);
        }, "/usr/bin/ffprobe");
    }

    @Test void challengeEntry_measuresTheStoredObjectAndRoundsPartialMillisecondsUp() {
        assertThat(media(0, "60.0004\n").durationMs("videos/a")).isEqualTo(60_001);
        assertThat(commands.getFirst()).last().isEqualTo("https://storage.test/videos/a");
        assertThat(media(0, "45.000000").durationMs("videos/b")).isEqualTo(45_000);
    }

    @Test void challengeEntry_unreadableOrMissingObjectsAreNotReady() {
        assertThatThrownBy(() -> media(1, "videos/a: Server returned 404 Not Found").durationMs("videos/a"))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getMessage()).contains("video_not_ready"));
        assertThatThrownBy(() -> media(0, "N/A").durationMs("videos/a"))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getMessage()).contains("video_not_ready"));
    }
}
