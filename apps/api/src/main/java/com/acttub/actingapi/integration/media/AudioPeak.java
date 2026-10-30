package com.acttub.actingapi.integration.media;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/**
 * 녹음 전체에서 가장 큰 소리(dBFS)를 잰다. 말했는지 가늠하는 값이지 음성 인식이 아니다 — 리딩 녹음 다시 받아쓰기가 무음
 * 녹음을 받아쓰기 모델에 보내지 않으려고 쓴다.
 */
public final class AudioPeak {
    private static final String PEAK = "lavfi.astats.Overall.Peak_level=";
    static final Duration TIMEOUT = Duration.ofSeconds(60);

    /** @return 가장 큰 소리. 완전한 무음이면 {@link Double#NEGATIVE_INFINITY} */
    public double peakDb(Path source) {
        Path metadata = null;
        try {
            metadata = Files.createTempFile(source.toAbsolutePath().getParent(), "acttub-peak-", ".txt");
            Path output = metadata;
            FfmpegLock.run(() -> {
                Ffmpeg.process("audio peak").run(List.of("ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
                        "-threads", "1", "-i", source.toString(), "-map", "0:a:0", "-vn",
                        "-af", "astats=metadata=1:reset=0:measure_perchannel=none:measure_overall=Peak_level,"
                                + "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=" + output,
                        "-f", "null", "-"), TIMEOUT);
                return null;
            });
            try (BufferedReader lines = Files.newBufferedReader(metadata)) {
                return lastPeak(lines);
            }
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("audio peak measurement failed", failure);
        } finally {
            if (metadata != null) {
                try {
                    Files.deleteIfExists(metadata);
                } catch (IOException cleanup) {
                    metadata.toFile().deleteOnExit();
                }
            }
        }
    }

    /** 누적 측정이라 마지막 프레임의 값이 녹음 전체의 최댓값이다. 값이 하나도 없으면 읽지 못한 것이다. */
    static double lastPeak(BufferedReader lines) throws IOException {
        Double last = null;
        for (String line = lines.readLine(); line != null; line = lines.readLine()) {
            int at = line.indexOf(PEAK);
            if (at < 0) {
                continue;
            }
            String value = line.substring(at + PEAK.length()).strip();
            last = value.equals("-inf") ? Double.NEGATIVE_INFINITY : Double.parseDouble(value);
        }
        if (last == null) {
            throw new IOException("ffmpeg printed no peak level");
        }
        return last;
    }
}
