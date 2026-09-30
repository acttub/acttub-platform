package com.acttub.actingapi.integration.media;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/**
 * 어떤 형식의 음성이든 m4a(AAC)로 바꾼다 — 리딩 녹음의 저장 형식은 하나여야 이관 뒤 앱에서 웹 녹음을 들을 수 있다
 * (reading.recording, ADR-031). 내용은 읽지 않는다: 서버가 음성을 건드리는 유일한 일이다.
 *
 * <p>ffmpeg 는 {@link Ffmpeg} 의 방식으로 부른다. 반환한 파일은 호출자가 지운다. 실패하면 부분 출력을 지우고 원인을
 * 담아 던진다.
 */
public final class AudioTranscoder {
    static final Duration TIMEOUT = Duration.ofSeconds(120);
    private final Ffmpeg.CommandRunner runner;

    public AudioTranscoder() {
        this(Ffmpeg.process("audio transcode"));
    }

    public AudioTranscoder(Ffmpeg.CommandRunner runner) {
        this.runner = runner;
    }

    /** {@code source} 옆에 {@code .m4a} 파일을 만든다. 원본은 그대로 둔다. */
    public Path toM4a(Path source) {
        try {
            return Ffmpeg.produce(runner, TIMEOUT, source, "acttub-recording-", ".m4a", output -> List.of(
                    "ffmpeg", "-y", "-threads", "1", "-i", source.toString(),
                    "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
                    "-threads", "1", output.toString()), "ffmpeg produced empty audio");
        } catch (Exception exception) {
            throw new TranscodeFailed(exception);
        }
    }

    /** 변환하지 못했다 — 부르는 쪽이 503 {@code audio_conversion_failed} 로 답하고 기기가 같은 요청 id 로 다시 시도한다. */
    public static final class TranscodeFailed extends RuntimeException {
        TranscodeFailed(Throwable cause) {
            super("audio transcode failed", cause);
        }
    }
}
