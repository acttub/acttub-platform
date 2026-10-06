package com.acttub.actingapi.integration.media;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/** 원본 영상에서 16kHz 모노 PCM WAV를 추출한다. 반환한 파일은 호출자가 지운다. */
public final class AudioExtractor {
    static final Duration TIMEOUT = Duration.ofSeconds(600);
    private final Ffmpeg.CommandRunner runner;

    public AudioExtractor() {
        this(Ffmpeg.process("audio extraction"));
    }

    AudioExtractor(Ffmpeg.CommandRunner runner) {
        this.runner = runner;
    }

    public Path extract(Path videoPath) {
        try {
            return Ffmpeg.produce(runner, TIMEOUT, videoPath, "acttub-speech-", ".wav", output -> List.of(
                    "ffmpeg", "-y", "-threads", "1", "-i", videoPath.toString(),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    "-threads", "1", output.toString()), "ffmpeg produced empty audio");
        } catch (Exception exception) {
            throw new IllegalStateException("audio extraction failed", exception);
        }
    }
}
