package com.acttub.actingapi.integration.media;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * 영상을 그림 틀 안에 넣는다 (challenge.entry 공유 프레임). 빈 캔버스 위에 영상을 창 크기로 꽉 채워(가운데 잘라) 놓고, 창 자리가
 * 뚫린 틀 그림(PNG)을 덮는다. 원본 소리와 길이를 그대로 두고 H.264·AAC·yuv420p·faststart mp4 로 낸다.
 *
 * <p>영상 합성은 {@link Ffmpeg#produce} 로 {@link FfmpegLock} 을 잡고 돈다. 한 장면 뽑기({@link #still})는 저장소 주소에서
 * 앞부분만 읽는 짧은 일이라 락을 잡지 않는다 — 긴 합성 뒤에서 요청이 기다리지 않게.
 */
public final class FramedVideoComposer {
    private static final Duration TIMEOUT = Duration.ofMinutes(10);
    private static final long STILL_TIMEOUT_SECONDS = 30;
    /** 한 장면은 이 시각에서 뜬다 — 첫 프레임은 검거나 흔들린 경우가 많다. 앱이 3초 미만 영상은 올리지 않는다. */
    static final String STILL_AT = "0.5";
    private static final Pattern PATH_SEPARATOR = Pattern.compile(Pattern.quote(File.pathSeparator));

    private final Ffmpeg.CommandRunner runner;
    private final String ffmpeg;

    public FramedVideoComposer() {
        this(Ffmpeg.process("share frame"), executable("ffmpeg"));
    }

    FramedVideoComposer(Ffmpeg.CommandRunner runner, String ffmpeg) {
        this.runner = runner;
        this.ffmpeg = ffmpeg;
    }

    /** ffmpeg 가 PATH 에 있는가. */
    public boolean available() {
        return ffmpeg != null;
    }

    /**
     * {@code source} 옆에 틀을 씌운 mp4 를 만든다. 반환한 파일은 호출자가 지운다.
     *
     * @param overlay 캔버스 크기의 PNG. 창 자리는 투명하다
     * @param window  {x, y, 폭, 높이} — 캔버스 픽셀, 짝수
     */
    public Path compose(Path source, Path overlay, int width, int height, int[] window) throws Exception {
        if (ffmpeg == null) {
            throw new IllegalStateException("ffmpeg is unavailable");
        }
        return Ffmpeg.produce(runner, TIMEOUT, source, "acttub-frame-", ".mp4",
                output -> command(source, overlay, width, height, window, output), "ffmpeg produced an empty framed video");
    }

    List<String> command(Path source, Path overlay, int width, int height, int[] window, Path output) {
        String filter = "[0:v]scale=" + window[2] + ":" + window[3] + ":force_original_aspect_ratio=increase,"
                + "crop=" + window[2] + ":" + window[3] + ",setsar=1[video];"
                + "[2:v][video]overlay=" + window[0] + ":" + window[1] + ":shortest=1[base];"
                + "[base][1:v]overlay=0:0,format=yuv420p[out]";
        return List.of(ffmpeg, "-v", "error", "-y",
                "-i", source.toString(),
                "-loop", "1", "-i", overlay.toString(),
                "-f", "lavfi", "-i", "color=c=black:s=" + width + "x" + height + ":r=30",
                "-filter_complex", filter,
                "-map", "[out]", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-threads", "2", "-pix_fmt", "yuv420p", "-r", "30",
                "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", output.toString());
    }

    /** 영상({@code input} — 파일 경로나 서명 주소)의 한 장면을 PNG 바이트로 뽑는다. 회전은 반영된다. */
    public byte[] still(String input) throws IOException, InterruptedException {
        if (ffmpeg == null) {
            throw new IllegalStateException("ffmpeg is unavailable");
        }
        Process process = new ProcessBuilder(stillCommand(input)).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try (InputStream out = process.getInputStream()) {
            byte[] png = out.readAllBytes();
            if (!process.waitFor(STILL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new IOException("ffmpeg still timed out");
            }
            if (process.exitValue() != 0 || png.length == 0) {
                throw new IOException("ffmpeg still exited with status " + process.exitValue());
            }
            return png;
        } finally {
            process.destroyForcibly();
        }
    }

    List<String> stillCommand(String input) {
        // 주소에서 읽을 때 저장소가 멈춰도 끝나도록 읽기 시한(마이크로초)을 둔다.
        return input.startsWith("http")
                ? List.of(ffmpeg, "-v", "error", "-rw_timeout", "15000000", "-ss", STILL_AT, "-i", input,
                        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-")
                : List.of(ffmpeg, "-v", "error", "-ss", STILL_AT, "-i", input,
                        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-");
    }

    private static String executable(String command) {
        String path = System.getenv("PATH");
        if (path == null) {
            return null;
        }
        for (String directory : PATH_SEPARATOR.split(path)) {
            Path candidate = Path.of(directory, command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }
}
