package com.acttub.actingapi.integration.media;

import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 소리 파일 여럿을 순서대로 이어 16kHz 모노 PCM WAV 하나로 만든다. 파일마다 뒤에 빈 소리를 붙인다(리딩 녹음 코칭, SOMA-791).
 * 반환한 파일은 호출자가 지운다.
 */
public final class AudioJoiner {
    static final Duration TIMEOUT = Duration.ofSeconds(120);
    private final Ffmpeg.CommandRunner runner;

    public AudioJoiner() {
        this(Ffmpeg.process("audio join"));
    }

    AudioJoiner(Ffmpeg.CommandRunner runner) {
        this.runner = runner;
    }

    public Path join(List<Path> clips, int gapMs) {
        if (clips.isEmpty()) throw new IllegalArgumentException("no clips to join");
        try {
            return Ffmpeg.produce(runner, TIMEOUT, clips.getFirst(), "acttub-joined-", ".wav", output -> command(clips, gapMs, output),
                    "ffmpeg produced empty joined audio");
        } catch (Exception exception) {
            throw new IllegalStateException("audio join failed", exception);
        }
    }

    static List<String> command(List<Path> clips, int gapMs, Path output) {
        List<String> command = new ArrayList<>(List.of("ffmpeg", "-y", "-threads", "1"));
        for (Path clip : clips) {
            command.add("-i");
            command.add(clip.toString());
        }
        StringBuilder filter = new StringBuilder();
        String pad = String.format(Locale.ROOT, "%.3f", Math.max(0, gapMs) / 1000.0);
        for (int i = 0; i < clips.size(); i++) {
            filter.append('[').append(i).append(":a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono,apad=pad_dur=")
                    .append(pad).append("[a").append(i).append("];");
        }
        for (int i = 0; i < clips.size(); i++) filter.append("[a").append(i).append(']');
        filter.append("concat=n=").append(clips.size()).append(":v=0:a=1[out]");
        command.addAll(List.of("-filter_complex", filter.toString(), "-map", "[out]", "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", "-threads", "1", output.toString()));
        return command;
    }
}
