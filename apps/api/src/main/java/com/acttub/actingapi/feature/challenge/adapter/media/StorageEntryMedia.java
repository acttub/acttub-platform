package com.acttub.actingapi.feature.challenge.adapter.media;

import java.io.File;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 참여작 영상을 저장소에서 직접 읽는다. 길이는 기기가 올릴 때 적은 값이 아니라 ffprobe 가 객체의 머리를 읽어 잰
 * 값이다(challenge.entry "서버가 실제 길이 확인"). 짧은 재생 주소로 읽으므로 파일 전체를 받지 않는다.
 */
@Component
class StorageEntryMedia implements EntryMedia {
    private static final int PROBE_URL_SECONDS = 120;
    private static final int PLAYBACK_SECONDS = 600;
    private static final long TIMEOUT_SECONDS = 20;

    /** ffprobe 실행 한 번. 종료 코드와 표준 출력을 돌려준다. */
    interface Probe {
        Result run(List<String> command);
        record Result(int exitCode, String output) { }
    }

    private final VideoStorage storage;
    private final Probe probe;
    private final String ffprobe;

    @Autowired
    StorageEntryMedia(VideoStorage storage) { this(storage, StorageEntryMedia::execute, executable("ffprobe")); }

    StorageEntryMedia(VideoStorage storage, Probe probe, String ffprobe) {
        this.storage = storage; this.probe = probe; this.ffprobe = ffprobe;
    }

    @Override
    public int durationMs(String objectKey) {
        storage.requireConfigured();
        String url = storage.presignPlayback(objectKey, PROBE_URL_SECONDS);
        if (url == null || ffprobe == null) throw new IllegalStateException("video duration probe is unavailable");
        var result = probe.run(List.of(ffprobe, "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", url));
        // 객체가 없거나 영상으로 읽히지 않으면 참여할 수 없는 영상이다.
        if (result.exitCode() != 0) throw new ApiException(422, "video_not_ready");
        try {
            int duration = new BigDecimal(result.output().strip()).multiply(BigDecimal.valueOf(1000))
                    .setScale(0, RoundingMode.CEILING).intValueExact();
            if (duration <= 0) throw new ArithmeticException("no duration");
            return duration;
        } catch (NumberFormatException | ArithmeticException unreadable) {
            throw new ApiException(422, "video_not_ready");
        }
    }

    @Override
    public String playbackUrl(String objectKey) { return storage.presignPlayback(objectKey, PLAYBACK_SECONDS); }

    private static Probe.Result execute(List<String> command) {
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("video duration probe timed out");
            }
            return new Probe.Result(process.exitValue(),
                    new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
        } catch (java.io.IOException failure) {
            throw new IllegalStateException("video duration probe failed", failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("video duration probe interrupted", interrupted);
        }
    }

    private static String executable(String command) {
        String path = System.getenv("PATH");
        if (path == null) return null;
        for (String directory : path.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            Path candidate = Path.of(directory, command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toString();
        }
        return null;
    }
}
